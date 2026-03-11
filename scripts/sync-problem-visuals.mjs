import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { GoogleAuth } from 'google-auth-library'
import {
  PROBLEM_VISUAL_ALLOWED_FORMATS,
  PROBLEM_VISUAL_ALLOWED_MIME_TYPES,
  PROBLEM_VISUAL_BUCKET,
  PROBLEM_VISUAL_MAX_BYTES,
  PROBLEM_VISUAL_MAX_EDGE,
  PROBLEM_VISUAL_MODEL,
  PROBLEM_VISUAL_PROMPT_VERSION,
  PROBLEM_VISUAL_THUMB_EDGE,
} from '../src/lib/problem-visuals.js'
import { createServiceRoleClient, ensureDir, envValue, projectRoot, readJsonFile, writeJsonFile } from './_env.mjs'

const DEFAULT_MANIFEST_PATH = path.join(projectRoot, 'out', 'problem-visuals-manifest.json')
const DEFAULT_LOCAL_OUTPUT_DIR = path.join(projectRoot, 'out', 'problem-visuals-generated')
const DEFAULT_LOCAL_MANIFEST_NAME = 'problem-visuals-local-manifest.json'
const DEFAULT_LOCAL_SUMMARY_NAME = 'problem-visuals-local-summary.json'
const VERTEX_RETRY_DELAYS_MS = [15000, 30000, 60000]
const VERTEX_REQUEST_TIMEOUT_MS = 180000

function parseArgs(argv) {
  let manifestPath = DEFAULT_MANIFEST_PATH
  let mode = 'ingest'
  let dryRun = false
  let localOnly = false
  let skipExistingDb = false
  let limit = null
  let problemKeys = []
  let outputDir = DEFAULT_LOCAL_OUTPUT_DIR
  let projectId = ''
  let location = ''

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--manifest' && next) {
      manifestPath = path.resolve(next)
      index += 1
      continue
    }

    if (arg.startsWith('--manifest=')) {
      manifestPath = path.resolve(arg.slice('--manifest='.length))
      continue
    }

    if (arg === '--mode' && next) {
      mode = next.trim()
      index += 1
      continue
    }

    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim()
      continue
    }

    if (arg === '--problem-key' && next) {
      problemKeys.push(next.trim())
      index += 1
      continue
    }

    if (arg.startsWith('--problem-key=')) {
      problemKeys.push(arg.slice('--problem-key='.length).trim())
      continue
    }

    if (arg === '--limit' && next) {
      limit = Number(next)
      index += 1
      continue
    }

    if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length))
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--local-only') {
      localOnly = true
      continue
    }

    if (arg === '--skip-existing-db') {
      skipExistingDb = true
      continue
    }

    if (arg === '--output-dir' && next) {
      outputDir = path.resolve(next)
      index += 1
      continue
    }

    if (arg.startsWith('--output-dir=')) {
      outputDir = path.resolve(arg.slice('--output-dir='.length))
      continue
    }

    if (arg === '--project' && next) {
      projectId = next.trim()
      index += 1
      continue
    }

    if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length).trim()
      continue
    }

    if (arg === '--location' && next) {
      location = next.trim()
      index += 1
      continue
    }

    if (arg.startsWith('--location=')) {
      location = arg.slice('--location='.length).trim()
    }
  }

  return {
    manifestPath,
    mode,
    dryRun,
    localOnly,
    skipExistingDb,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
    problemKeys: problemKeys.filter(Boolean),
    outputDir,
    projectId,
    location,
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizePathSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '')
}

function runGcloudCommand(args, description) {
  try {
    return execFileSync('gcloud', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = String(error?.stderr || '').trim()
    const stdout = String(error?.stdout || '').trim()
    const details = stderr || stdout || String(error)
    throw new Error(`gcloud ${description} failed: ${details}`)
  }
}

function resolveManifestImagePath(row, manifestPath) {
  const source = String(row.image_path || '').trim()
  if (!source) {
    throw new Error(`${row.problem_key}: image_path is required in ingest mode.`)
  }

  return path.isAbsolute(source) ? source : path.resolve(path.dirname(manifestPath), source)
}

async function getGoogleAccessToken() {
  const explicitToken = envValue('GOOGLE_CLOUD_ACCESS_TOKEN')
  if (explicitToken) {
    return explicitToken
  }

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })

    const client = await auth.getClient()
    const tokenResult = await client.getAccessToken()
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token

    if (token) {
      return token
    }
  } catch {
    // Fall through to the gcloud CLI when ADC is unavailable locally.
  }

  const gcloudToken = runGcloudCommand(['auth', 'print-access-token'], 'auth print-access-token')
  if (!gcloudToken) {
    throw new Error('Unable to acquire a Google Cloud access token for Vertex AI.')
  }

  return gcloudToken
}

function resolveGoogleProjectId(explicitProjectId = '') {
  const projectId = String(explicitProjectId || envValue('GOOGLE_CLOUD_PROJECT') || '').trim()
  if (projectId) {
    return projectId
  }

  const gcloudProject = runGcloudCommand(['config', 'get-value', 'project'], 'config get-value project')
  if (!gcloudProject || gcloudProject === '(unset)') {
    throw new Error('Missing Google Cloud project for Vertex AI generation. Set --project, GOOGLE_CLOUD_PROJECT, or your gcloud config project.')
  }

  return gcloudProject
}

function buildVertexEndpoint(explicitProjectId = '', explicitLocation = '') {
  const projectId = resolveGoogleProjectId(explicitProjectId)
  const location = String(explicitLocation || envValue('GOOGLE_CLOUD_LOCATION') || 'global').trim() || 'global'

  return {
    projectId,
    location,
    url: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${PROBLEM_VISUAL_MODEL}:generateContent`,
  }
}

function buildGenerationPrompt(row) {
  return [
    `Create a crisp, statement-faithful diagram for the coding problem "${row.title}".`,
    `Track: ${row.track}`,
    `Placement section: ${row.section}`,
    `Scene brief: ${row.prompt_brief}`,
    'Representation policy:',
    '- depict the problem statement or example faithfully, not the editorial solution',
    '- prefer the example-style visual a platform like LeetCode would place inside the statement',
    '- do not include formulas, complexity notes, algorithm names, or optimization hints inside the image',
    '- do not include explanatory sentences or teaching callout boxes inside the image',
    '- if the metadata suggests reasoning or explanation, convert it into simple visual structure instead of text',
    '- keep any text inside the image minimal and limited to problem-domain labels, sample values, row or column labels, or simple markers such as i and j',
    'Style requirements:',
    '- use a neutral off-white canvas that works in both light and dark product themes',
    '- use charcoal or near-black labels with strong contrast',
    '- primary accent color should match teal #14b8a6',
    '- optional secondary accent can be amber or orange for emphasis',
    '- muted inactive elements should use light slate gray, not saturated colors',
    '- 2 to 3 accent colors only',
    '- use arrows only when they are part of the problem depiction, not as tutorial annotations',
    '- avoid floating legends unless the problem statement naturally needs them',
    '- no logos, no watermarks, no decorative clutter',
    '- suitable for a programming study app',
    '- preserve crisp text and diagram edges',
    '- include comfortable inner padding so the diagram reads like a clean figure on a page',
    '- do not use a dark background',
  ].join('\n')
}

async function generateGeminiImage(row, options = {}) {
  const endpoint = buildVertexEndpoint(options.projectId, options.location)

  for (let attempt = 0; attempt <= VERTEX_RETRY_DELAYS_MS.length; attempt += 1) {
    let response
    try {
      const accessToken = await getGoogleAccessToken()
      response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: buildGenerationPrompt(row) }],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
              aspectRatio: row.aspect_ratio || '16:9',
            },
          },
        }),
        signal: AbortSignal.timeout(VERTEX_REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isTransient = message.includes('fetch failed') || message.includes('This operation was aborted') || message.includes('timed out')
      if (isTransient && attempt < VERTEX_RETRY_DELAYS_MS.length) {
        await sleep(VERTEX_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new Error(`${row.problem_key}: Vertex AI request failed before response. ${message}`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      if ((response.status === 429 || response.status >= 500) && attempt < VERTEX_RETRY_DELAYS_MS.length) {
        await sleep(VERTEX_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new Error(`${row.problem_key}: Vertex AI request failed (${response.status}) ${errorText}`)
    }

    const payload = await response.json()
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
    const parts = candidates.flatMap((candidate) => candidate?.content?.parts || [])
    const imagePart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data)

    if (!imagePart) {
      const textParts = parts
        .map((part) => String(part?.text || '').trim())
        .filter(Boolean)
        .join(' ')
      throw new Error(`${row.problem_key}: ${PROBLEM_VISUAL_MODEL} returned no image.${textParts ? ` ${textParts}` : ''}`)
    }

    const inlineData = imagePart.inlineData || imagePart.inline_data
    const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || '').trim() || 'image/png'
    return {
      buffer: Buffer.from(inlineData.data, 'base64'),
      mimeType,
    }
  }

  throw new Error(`${row.problem_key}: Vertex AI generation exhausted retry attempts.`)
}

async function optimizeMainImage(buffer, preferredFormat) {
  assert(PROBLEM_VISUAL_ALLOWED_FORMATS.includes(preferredFormat), `Unsupported preferred format: ${preferredFormat}`)
  const widths = [PROBLEM_VISUAL_MAX_EDGE, 1440, 1280, 1120, 960]
  const webpQualities = [100, 96, 92, 88, 84, 80]
  let best = null

  for (const width of widths) {
    if (preferredFormat === 'png') {
      const pngBuffer = await sharp(buffer, { limitInputPixels: false })
        .rotate()
        .resize({
          width,
          height: width,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png({
          compressionLevel: 9,
          effort: 10,
          palette: true,
          colors: 256,
        })
        .toBuffer()

      const metadata = await sharp(pngBuffer, { limitInputPixels: false }).metadata()
      if (!best || pngBuffer.length < best.buffer.length) {
        best = {
          buffer: pngBuffer,
          mimeType: 'image/png',
          extension: 'png',
          width: metadata.width || width,
          height: metadata.height || width,
        }
      }

      if (pngBuffer.length <= PROBLEM_VISUAL_MAX_BYTES) {
        return best
      }

      continue
    }

    for (const quality of webpQualities) {
      const webpBuffer = await sharp(buffer, { limitInputPixels: false })
        .rotate()
        .resize({
          width,
          height: width,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality,
          effort: 6,
          nearLossless: quality >= 92,
        })
        .toBuffer()

      const metadata = await sharp(webpBuffer, { limitInputPixels: false }).metadata()
      if (!best || webpBuffer.length < best.buffer.length) {
        best = {
          buffer: webpBuffer,
          mimeType: 'image/webp',
          extension: 'webp',
          width: metadata.width || width,
          height: metadata.height || width,
        }
      }

      if (webpBuffer.length <= PROBLEM_VISUAL_MAX_BYTES) {
        return best
      }
    }
  }

  throw new Error(`Unable to optimize image below ${PROBLEM_VISUAL_MAX_BYTES} bytes.`)
}

async function optimizeThumbnail(buffer) {
  const thumbBuffer = await sharp(buffer, { limitInputPixels: false })
    .rotate()
    .resize({
      width: PROBLEM_VISUAL_THUMB_EDGE,
      height: PROBLEM_VISUAL_THUMB_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: 88,
      effort: 6,
      nearLossless: true,
    })
    .toBuffer()

  return {
    buffer: thumbBuffer,
    mimeType: 'image/webp',
    extension: 'webp',
  }
}

function buildLocalOutputPaths(row, outputDir, extension, thumbExtension) {
  const problemKey = sanitizePathSegment(row.problem_key)
  const visualId = sanitizePathSegment(row.id)
  const rowDir = path.join(outputDir, problemKey)

  return {
    rowDir,
    mainPath: path.join(rowDir, `${visualId}.${extension}`),
    thumbPath: path.join(rowDir, `thumb-${visualId}.${thumbExtension}`),
  }
}

function toManifestRelativePath(filePath, manifestPath) {
  const relativePath = path.relative(path.dirname(manifestPath), filePath)
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

function writeLocalArtifacts(row, optimizedMain, optimizedThumb, outputDir) {
  const { rowDir, mainPath, thumbPath } = buildLocalOutputPaths(row, outputDir, optimizedMain.extension, optimizedThumb.extension)
  ensureDir(rowDir)
  fs.writeFileSync(mainPath, optimizedMain.buffer)
  fs.writeFileSync(thumbPath, optimizedThumb.buffer)

  return {
    mainPath,
    thumbPath,
  }
}

function getPresentationVisuals(presentation) {
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    return []
  }

  return Array.isArray(presentation.visuals) ? presentation.visuals : []
}

function hasMatchingVisual(presentation, row) {
  const visuals = getPresentationVisuals(presentation)
  return visuals.some((visual) => String(visual?.id || '').trim() === row.id)
}

async function loadExistingProblemVisualIndex(supabase, rows) {
  const keys = [...new Set(rows.map((row) => row.problem_key).filter(Boolean))]
  const existing = new Map()

  for (let index = 0; index < keys.length; index += 100) {
    const slice = keys.slice(index, index + 100)
    const { data, error } = await supabase
      .from('problem_content')
      .select('problem_key,presentation')
      .in('problem_key', slice)

    if (error) {
      throw error
    }

    for (const row of data || []) {
      existing.set(row.problem_key, row.presentation)
    }
  }

  return existing
}

async function ensureBucket(supabase) {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) {
    throw listError
  }

  const existing = (buckets || []).find((bucket) => bucket.name === PROBLEM_VISUAL_BUCKET || bucket.id === PROBLEM_VISUAL_BUCKET)
  if (!existing) {
    const { error } = await supabase.storage.createBucket(PROBLEM_VISUAL_BUCKET, {
      public: true,
      fileSizeLimit: `${PROBLEM_VISUAL_MAX_BYTES}`,
      allowedMimeTypes: PROBLEM_VISUAL_ALLOWED_MIME_TYPES,
    })
    if (error) {
      throw error
    }
    return
  }

  const { error: updateError } = await supabase.storage.updateBucket(PROBLEM_VISUAL_BUCKET, {
    public: true,
    fileSizeLimit: `${PROBLEM_VISUAL_MAX_BYTES}`,
    allowedMimeTypes: PROBLEM_VISUAL_ALLOWED_MIME_TYPES,
  })

  if (updateError) {
    throw updateError
  }
}

function buildStoragePaths(row, extension, thumbExtension) {
  const problemKey = sanitizePathSegment(row.problem_key)
  const visualId = sanitizePathSegment(row.id)
  return {
    mainPath: `${problemKey}/${visualId}.${extension}`,
    thumbPath: `${problemKey}/thumb-${visualId}.${thumbExtension}`,
  }
}

function getPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(PROBLEM_VISUAL_BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

async function uploadAsset(supabase, storagePath, buffer, mimeType) {
  const { error } = await supabase.storage.from(PROBLEM_VISUAL_BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: true,
    cacheControl: '31536000',
  })

  if (error) {
    throw error
  }
}

async function cleanupAssets(supabase, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return
  }
  await supabase.storage.from(PROBLEM_VISUAL_BUCKET).remove(paths)
}

async function upsertProblemVisual(supabase, row, optimizedMain, optimizedThumb) {
  const { data: contentRow, error: fetchError } = await supabase
    .from('problem_content')
    .select('problem_key,presentation')
    .eq('problem_key', row.problem_key)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  if (!contentRow) {
    throw new Error(`${row.problem_key}: problem_content row not found.`)
  }

  const { mainPath, thumbPath } = buildStoragePaths(row, optimizedMain.extension, optimizedThumb.extension)
  const uploadedPaths = []

  try {
    await uploadAsset(supabase, mainPath, optimizedMain.buffer, optimizedMain.mimeType)
    uploadedPaths.push(mainPath)
    await uploadAsset(supabase, thumbPath, optimizedThumb.buffer, optimizedThumb.mimeType)
    uploadedPaths.push(thumbPath)

    const presentation =
      contentRow.presentation && typeof contentRow.presentation === 'object' && !Array.isArray(contentRow.presentation)
        ? { ...contentRow.presentation }
        : {}
    const visuals = Array.isArray(presentation.visuals) ? [...presentation.visuals] : []
    const nextVisual = {
      id: row.id,
      section: row.section,
      kind: row.kind,
      public_url: getPublicUrl(supabase, mainPath),
      thumb_url: getPublicUrl(supabase, thumbPath),
      storage_path: mainPath,
      mime_type: optimizedMain.mimeType,
      width: optimizedMain.width,
      height: optimizedMain.height,
      alt: row.alt,
      caption: row.caption,
      assistant_context: row.assistant_context,
      source_model: PROBLEM_VISUAL_MODEL,
      prompt_version: PROBLEM_VISUAL_PROMPT_VERSION,
      sort_order: Number(row.sort_order) || 0,
    }

    const filtered = visuals.filter((visual) => String(visual?.id || '').trim() !== row.id)
    presentation.visuals = [...filtered, nextVisual].sort((left, right) => (Number(left?.sort_order) || 0) - (Number(right?.sort_order) || 0))

    const { error: updateError } = await supabase
      .from('problem_content')
      .update({ presentation })
      .eq('problem_key', row.problem_key)

    if (updateError) {
      throw updateError
    }
  } catch (error) {
    await cleanupAssets(supabase, uploadedPaths)
    throw error
  }
}

function validateRow(row) {
  assert(row.source_model === PROBLEM_VISUAL_MODEL, `${row.problem_key}: source_model must equal ${PROBLEM_VISUAL_MODEL}`)
  assert(row.prompt_version === PROBLEM_VISUAL_PROMPT_VERSION, `${row.problem_key}: prompt_version must equal ${PROBLEM_VISUAL_PROMPT_VERSION}`)
  assert(Boolean(String(row.problem_key || '').trim()), 'problem_key is required')
  assert(Boolean(String(row.id || '').trim()), `${row.problem_key}: id is required`)
  assert(Boolean(String(row.title || '').trim()), `${row.problem_key}: title is required`)
  assert(Boolean(String(row.kind || '').trim()), `${row.problem_key}: kind is required`)
  assert(Boolean(String(row.alt || '').trim()), `${row.problem_key}: alt is required`)
  assert(Boolean(String(row.caption || '').trim()), `${row.problem_key}: caption is required`)
  assert(Boolean(String(row.assistant_context || '').trim()), `${row.problem_key}: assistant_context is required`)
  assert(Boolean(String(row.prompt_brief || '').trim()), `${row.problem_key}: prompt_brief is required`)
  assert(PROBLEM_VISUAL_ALLOWED_FORMATS.includes(row.preferred_format), `${row.problem_key}: invalid preferred_format ${row.preferred_format}`)
}

async function processRow(supabase, row, mode, manifestPath, dryRun, generateOptions) {
  validateRow(row)

  if (dryRun) {
    return {
      problem_key: row.problem_key,
      status: 'dry-run',
      mode,
    }
  }

  const source =
    mode === 'generate'
      ? await generateGeminiImage(row, generateOptions)
      : {
          buffer: fs.readFileSync(resolveManifestImagePath(row, manifestPath)),
          mimeType: '',
        }

  const optimizedMain = await optimizeMainImage(source.buffer, row.preferred_format)
  const optimizedThumb = await optimizeThumbnail(source.buffer)
  await upsertProblemVisual(supabase, row, optimizedMain, optimizedThumb)

  return {
    problem_key: row.problem_key,
    status: 'synced',
    mode,
    bytes: optimizedMain.buffer.length,
    mime_type: optimizedMain.mimeType,
    width: optimizedMain.width,
    height: optimizedMain.height,
  }
}

async function processRowLocal(row, outputDir, dryRun, generateOptions) {
  validateRow(row)

  if (dryRun) {
    return {
      problem_key: row.problem_key,
      status: 'dry-run',
      mode: 'generate',
      local_only: true,
    }
  }

  const source = await generateGeminiImage(row, generateOptions)
  const optimizedMain = await optimizeMainImage(source.buffer, row.preferred_format)
  const optimizedThumb = await optimizeThumbnail(source.buffer)
  const artifacts = writeLocalArtifacts(row, optimizedMain, optimizedThumb, outputDir)

  return {
    problem_key: row.problem_key,
    status: 'generated-local',
    mode: 'generate',
    local_only: true,
    bytes: optimizedMain.buffer.length,
    mime_type: optimizedMain.mimeType,
    width: optimizedMain.width,
    height: optimizedMain.height,
    image_path: artifacts.mainPath,
    thumb_path: artifacts.thumbPath,
  }
}

function buildLocalManifest(rows, results, localManifestPath) {
  const existingRows = fs.existsSync(localManifestPath) ? readJsonFile(localManifestPath) : []
  const existingByKey = new Map(
    Array.isArray(existingRows) ? existingRows.map((row) => [row.problem_key, row]) : [],
  )
  const successfulByKey = new Map(
    results
      .filter((result) => result.status === 'generated-local' && result.image_path)
      .map((result) => [result.problem_key, result]),
  )

  for (const row of rows) {
    if (!successfulByKey.has(row.problem_key)) {
      continue
    }

    const generated = successfulByKey.get(row.problem_key)
    existingByKey.set(row.problem_key, {
      ...row,
      image_path: toManifestRelativePath(generated.image_path, localManifestPath),
      thumb_path: toManifestRelativePath(generated.thumb_path, localManifestPath),
    })
  }

  return [...existingByKey.values()].sort((left, right) => {
    if ((left.track || '') !== (right.track || '')) {
      return String(left.track || '').localeCompare(String(right.track || ''))
    }
    if ((left.tier ?? 0) !== (right.tier ?? 0)) {
      return (left.tier ?? 0) - (right.tier ?? 0)
    }
    if ((left.study_order ?? 0) !== (right.study_order ?? 0)) {
      return (left.study_order ?? 0) - (right.study_order ?? 0)
    }
    return String(left.title || '').localeCompare(String(right.title || ''))
  })
}

async function main() {
  const { manifestPath, mode, dryRun, localOnly, skipExistingDb, limit, problemKeys, outputDir, projectId, location } = parseArgs(process.argv.slice(2))
  assert(mode === 'generate' || mode === 'ingest', '--mode must be either generate or ingest.')
  assert(!localOnly || mode === 'generate', '--local-only is only supported with --mode=generate.')
  assert(!skipExistingDb || !localOnly, '--skip-existing-db is only supported for non-local sync runs.')

  const manifest = readJsonFile(manifestPath)
  assert(Array.isArray(manifest), 'Manifest must be a JSON array.')

  let rows = manifest
  if (problemKeys.length > 0) {
    const allowed = new Set(problemKeys)
    rows = rows.filter((row) => allowed.has(row.problem_key))
  }

  if (limit) {
    rows = rows.slice(0, limit)
  }

  const summary = {
    manifest_path: manifestPath,
    mode,
    dry_run: dryRun,
    local_only: localOnly,
    skip_existing_db: skipExistingDb,
    requested_rows: rows.length,
    results: [],
  }

  let supabase = null
  let existingByProblemKey = null
  if (!localOnly && !dryRun) {
    supabase = createServiceRoleClient()
    await ensureBucket(supabase)
    if (skipExistingDb) {
      existingByProblemKey = await loadExistingProblemVisualIndex(supabase, rows)
    }
  }

  for (const row of rows) {
    try {
      if (existingByProblemKey && hasMatchingVisual(existingByProblemKey.get(row.problem_key), row)) {
        const skipped = {
          problem_key: row.problem_key,
          status: 'skipped-existing',
          mode,
        }
        summary.results.push(skipped)
        console.log(JSON.stringify(skipped))
        continue
      }

      const result = localOnly
        ? await processRowLocal(row, outputDir, dryRun, { projectId, location })
        : await processRow(supabase, row, mode, manifestPath, dryRun, { projectId, location })
      summary.results.push(result)
      console.log(JSON.stringify(result))
    } catch (error) {
      const failure = {
        problem_key: row.problem_key,
        status: 'error',
        mode,
        message: error instanceof Error ? error.message : String(error),
      }
      summary.results.push(failure)
      console.error(JSON.stringify(failure))
      process.exitCode = 1
    }
  }

  if (localOnly && !dryRun) {
    const localManifestPath = path.join(outputDir, DEFAULT_LOCAL_MANIFEST_NAME)
    const localSummaryPath = path.join(outputDir, DEFAULT_LOCAL_SUMMARY_NAME)
    const localManifest = buildLocalManifest(rows, summary.results, localManifestPath)
    const localSummary = {
      generated_manifest_path: localManifestPath,
      generated_summary_path: localSummaryPath,
      generated_rows: localManifest.length,
      requested_rows: rows.length,
      failed_rows: summary.results.filter((result) => result.status === 'error').length,
      output_dir: outputDir,
      project_id: resolveGoogleProjectId(projectId),
      location: String(location || envValue('GOOGLE_CLOUD_LOCATION') || 'global').trim() || 'global',
    }

    writeJsonFile(localManifestPath, localManifest)
    writeJsonFile(localSummaryPath, localSummary)
    summary.generated_manifest_path = localManifestPath
    summary.generated_summary_path = localSummaryPath
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
