import fs from 'node:fs'
import path from 'node:path'
import {
  PROBLEM_VISUAL_ALLOWED_FORMATS,
  PROBLEM_VISUAL_ALLOWED_SECTIONS,
  PROBLEM_VISUAL_MODEL,
  PROBLEM_VISUAL_PROMPT_VERSION,
  buildProblemVisualManifest,
  extractProblemVisuals,
} from '../src/lib/problem-visuals.js'
import { createServiceRoleClient, projectRoot, readJsonFile } from './_env.mjs'

const DEFAULT_MANIFEST_PATH = path.join(projectRoot, 'out', 'problem-visuals-manifest.json')

function parseArgs(argv) {
  let manifestPath = DEFAULT_MANIFEST_PATH
  let checkDb = false
  let requireFiles = false
  let allowPartial = false

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

    if (arg === '--check-db') {
      checkDb = true
      continue
    }

    if (arg === '--require-files') {
      requireFiles = true
      continue
    }

    if (arg === '--allow-partial') {
      allowPartial = true
    }
  }

  return {
    manifestPath,
    checkDb,
    requireFiles,
    allowPartial,
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function validateManifestRow(row, requiredByKey, manifestDir, requireFiles) {
  const expected = requiredByKey.get(row.problem_key)
  assert(expected, `Manifest contains non-required problem_key: ${row.problem_key}`)
  assert(row.source_model === PROBLEM_VISUAL_MODEL, `${row.problem_key}: source_model must be ${PROBLEM_VISUAL_MODEL}`)
  assert(row.prompt_version === PROBLEM_VISUAL_PROMPT_VERSION, `${row.problem_key}: prompt_version mismatch`)
  assert(row.section === expected.section, `${row.problem_key}: section must be ${expected.section}`)
  assert(Boolean(String(row.alt || '').trim()), `${row.problem_key}: alt is required`)
  assert(Boolean(String(row.caption || '').trim()), `${row.problem_key}: caption is required`)
  assert(Boolean(String(row.assistant_context || '').trim()), `${row.problem_key}: assistant_context is required`)
  assert(Boolean(String(row.prompt_brief || '').trim()), `${row.problem_key}: prompt_brief is required`)
  assert(PROBLEM_VISUAL_ALLOWED_SECTIONS.includes(row.section), `${row.problem_key}: invalid section ${row.section}`)
  assert(PROBLEM_VISUAL_ALLOWED_FORMATS.includes(row.preferred_format), `${row.problem_key}: invalid format ${row.preferred_format}`)

  if (requireFiles) {
    const imagePath = String(row.image_path || '').trim()
    assert(Boolean(imagePath), `${row.problem_key}: image_path is required when --require-files is set`)
    const resolvedPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(manifestDir, imagePath)
    assert(fs.existsSync(resolvedPath), `${row.problem_key}: image_path not found at ${resolvedPath}`)
  }
}

async function validateDatabaseCoverage(supabase, requiredRows) {
  const keys = requiredRows.map((row) => row.problem_key)
  const rows = []

  for (let index = 0; index < keys.length; index += 100) {
    const slice = keys.slice(index, index + 100)
    const { data, error } = await supabase
      .from('problem_content')
      .select('problem_key,presentation')
      .in('problem_key', slice)

    if (error) {
      throw error
    }

    rows.push(...(data || []))
  }

  const byKey = new Map(rows.map((row) => [row.problem_key, row]))

  for (const required of requiredRows) {
    const row = byKey.get(required.problem_key)
    assert(row, `Missing problem_content row for ${required.problem_key}`)
    const visuals = extractProblemVisuals(row.presentation, required.section)
    assert(visuals.length > 0, `${required.problem_key}: no visual found in presentation.visuals for section ${required.section}`)

    const matching = visuals.find((visual) => visual.id === required.id) ?? visuals[0]
    assert(matching.source_model === PROBLEM_VISUAL_MODEL, `${required.problem_key}: DB visual source_model must be ${PROBLEM_VISUAL_MODEL}`)
    assert(Boolean(matching.public_url), `${required.problem_key}: DB visual missing public_url`)
    assert(Boolean(matching.caption), `${required.problem_key}: DB visual missing caption`)
    assert(Boolean(matching.assistant_context), `${required.problem_key}: DB visual missing assistant_context`)
  }
}

async function main() {
  const { manifestPath, checkDb, requireFiles, allowPartial } = parseArgs(process.argv.slice(2))
  const supabase = createServiceRoleClient()
  const manifest = readJsonFile(manifestPath)
  const manifestDir = path.dirname(manifestPath)

  assert(Array.isArray(manifest), 'Manifest must be a JSON array.')

  const { data, error } = await supabase
    .from('v_study_problems')
    .select('problem_key,title,track_key,phase_name,category,source_platform,tier,study_order,problem_lc')

  if (error) {
    throw error
  }

  const requiredRows = buildProblemVisualManifest(data ?? [])
  const requiredByKey = new Map(requiredRows.map((row) => [row.problem_key, row]))

  const seen = new Set()
  for (const row of manifest) {
    assert(!seen.has(row.problem_key), `Duplicate manifest row for ${row.problem_key}`)
    seen.add(row.problem_key)
    validateManifestRow(row, requiredByKey, manifestDir, requireFiles)
  }

  if (!allowPartial) {
    const missing = requiredRows.filter((row) => !seen.has(row.problem_key)).map((row) => row.problem_key)
    assert(missing.length === 0, `Manifest missing required problems: ${missing.slice(0, 20).join(', ')}`)
  }

  if (checkDb) {
    const rowsToCheck = allowPartial ? requiredRows.filter((row) => seen.has(row.problem_key)) : requiredRows
    await validateDatabaseCoverage(supabase, rowsToCheck)
  }

  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        manifest_rows: manifest.length,
        required_rows: requiredRows.length,
        check_db: checkDb,
        require_files: requireFiles,
        allow_partial: allowPartial,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
