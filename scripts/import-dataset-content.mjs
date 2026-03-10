import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(projectRoot, '..')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const values = {}

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const splitIndex = line.indexOf('=')
    if (splitIndex <= 0) {
      continue
    }

    const key = line.slice(0, splitIndex).trim()
    let value = line.slice(splitIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

function envValue(key) {
  if (process.env[key]) {
    return process.env[key]
  }

  const localEnv = loadDotEnv(path.join(projectRoot, '.env.local'))
  if (localEnv[key]) {
    return localEnv[key]
  }

  const baseEnv = loadDotEnv(path.join(projectRoot, '.env'))
  if (baseEnv[key]) {
    return baseEnv[key]
  }

  return undefined
}

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toNullableText(value) {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value)
  return text.length > 0 ? text : null
}

function toDateValue(value) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString().slice(0, 10)
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
}

async function restRequest(url, key, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const parsed = text && isJson ? JSON.parse(text) : text

  if (!response.ok) {
    const message = typeof parsed === 'string' ? parsed.slice(0, 1000) : JSON.stringify(parsed)
    throw new Error(`HTTP ${response.status}: ${message}`)
  }

  return parsed
}

async function fetchExactCount(url, key) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })

  if (!response.ok && response.status !== 206) {
    const text = await response.text()
    throw new Error(`Failed to read count (${response.status}): ${text.slice(0, 500)}`)
  }

  const contentRange = response.headers.get('content-range') ?? ''
  const total = Number(contentRange.split('/')[1])
  return Number.isFinite(total) ? total : null
}

function normalizeContentRow(row, roadmapProblem) {
  return {
    problem_lc: roadmapProblem.problem_lc,
    task_id: toNullableText(row?.task_id) ?? roadmapProblem.slug,
    title: toNullableText(row?.title) ?? roadmapProblem.title,
    difficulty: toNullableText(row?.difficulty) ?? roadmapProblem.difficulty,
    tags: normalizeArray(row?.tags),
    problem_description: toNullableText(row?.problem_description),
    starter_code: toNullableText(row?.starter_code),
    entry_point: toNullableText(row?.entry_point),
    estimated_date: toDateValue(row?.estimated_date),
    dataset_prompt: toNullableText(row?.dataset_prompt),
    dataset_completion: toNullableText(row?.dataset_completion),
    dataset_query: toNullableText(row?.dataset_query),
    dataset_response: toNullableText(row?.dataset_response),
    dataset_test_harness: toNullableText(row?.dataset_test_harness),
    input_output: normalizeArray(row?.input_output),
    source: toNullableText(row?.source) ?? 'manual',
    dataset_split: toNullableText(row?.dataset_split),
  }
}

async function loadExistingContentRows(contentUrl, key, problemLcs) {
  const byLc = new Map()
  const selectFields = [
    'problem_lc',
    'task_id',
    'title',
    'difficulty',
    'tags',
    'problem_description',
    'starter_code',
    'entry_point',
    'estimated_date',
    'dataset_prompt',
    'dataset_completion',
    'dataset_query',
    'dataset_response',
    'dataset_test_harness',
    'input_output',
    'source',
    'dataset_split',
  ].join(',')

  for (const lcBatch of chunk(problemLcs, 50)) {
    const inClause = lcBatch.join(',')
    const rows = await restRequest(`${contentUrl}?select=${selectFields}&problem_lc=in.(${inClause})`, key)

    for (const row of rows ?? []) {
      const lc = toNumber(row?.problem_lc)
      if (lc) {
        byLc.set(lc, row)
      }
    }
  }

  return byLc
}

function addRoadmapProblem(map, node, track, pair) {
  const lc = toNumber(node?.lc)
  if (!lc) {
    return
  }

  const existing = map.get(lc)
  if (existing) {
    return
  }

  map.set(lc, {
    problem_lc: lc,
    track,
    title: toNullableText(node?.title),
    slug: toNullableText(node?.slug),
    difficulty: toNullableText(node?.difficulty),
    phase: toNumber(pair?.phase),
    phase_name: toNullableText(pair?.phase_name),
    phase_order: toNumber(pair?.phase_order),
    tier: toNumber(node?.tier) ?? toNumber(pair?.tier),
    leetcode_url: toNullableText(node?.leetcode_url),
    companies: normalizeArray(node?.companies),
  })
}

function loadRoadmapProblems(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Roadmap file not found: ${filePath}`)
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const pairs = Array.isArray(raw?.problems) ? raw.problems : []
  const byLc = new Map()

  for (const pair of pairs) {
    addRoadmapProblem(byLc, pair?.neetcode, 'neetcode', pair)
    addRoadmapProblem(byLc, pair?.companion, 'companion', pair)
  }

  if (byLc.size === 0) {
    throw new Error('No roadmap LC IDs found in dsa-companions.json')
  }

  return byLc
}

async function loadDatasetByQuestionId(trainPath, testPath) {
  const byId = new Map()

  async function readFile(filePath, split) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Dataset file not found: ${filePath}`)
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      let row
      try {
        row = JSON.parse(trimmed)
      } catch {
        continue
      }

      const questionId = toNumber(row?.question_id)
      if (!questionId) {
        continue
      }

      if (!byId.has(questionId)) {
        byId.set(questionId, { split, row })
      }
    }
  }

  // Prefer train row when duplicates exist.
  await readFile(trainPath, 'train')
  await readFile(testPath, 'test')

  return byId
}

function toContentRow(roadmapProblem, datasetMatch, existingRow = null) {
  if (!datasetMatch) {
    if (existingRow) {
      return normalizeContentRow(existingRow, roadmapProblem)
    }

    return {
      problem_lc: roadmapProblem.problem_lc,
      task_id: roadmapProblem.slug,
      title: roadmapProblem.title,
      difficulty: roadmapProblem.difficulty,
      tags: [],
      problem_description: null,
      starter_code: null,
      entry_point: null,
      estimated_date: null,
      dataset_prompt: null,
      dataset_completion: null,
      dataset_query: null,
      dataset_response: null,
      dataset_test_harness: null,
      input_output: [],
      source: 'manual',
      dataset_split: null,
    }
  }

  const { split, row } = datasetMatch

  return {
    problem_lc: roadmapProblem.problem_lc,
    task_id: toNullableText(row?.task_id) ?? roadmapProblem.slug,
    title: roadmapProblem.title ?? toNullableText(row?.task_id),
    difficulty: roadmapProblem.difficulty ?? toNullableText(row?.difficulty),
    tags: normalizeArray(row?.tags),
    problem_description: toNullableText(row?.problem_description),
    starter_code: toNullableText(row?.starter_code),
    entry_point: toNullableText(row?.entry_point),
    estimated_date: toDateValue(row?.estimated_date),
    dataset_prompt: toNullableText(row?.prompt),
    dataset_completion: toNullableText(row?.completion),
    dataset_query: toNullableText(row?.query),
    dataset_response: toNullableText(row?.response),
    dataset_test_harness: toNullableText(row?.test),
    input_output: normalizeArray(row?.input_output),
    source: 'dataset',
    dataset_split: split,
  }
}

function toDatasetCaseRows(problemLc, datasetMatch) {
  if (!datasetMatch) {
    return []
  }

  const ioRows = normalizeArray(datasetMatch.row?.input_output)
  const rows = []

  for (let index = 0; index < ioRows.length; index += 1) {
    const item = ioRows[index] ?? {}
    const inputValue =
      typeof item?.input === 'string' ? item.input : JSON.stringify(item?.input ?? null, null, 2)
    const outputValue =
      typeof item?.output === 'string' ? item.output : JSON.stringify(item?.output ?? null, null, 2)

    rows.push({
      problem_lc: problemLc,
      sort_order: index + 1,
      input_text: inputValue ?? '',
      expected_output: outputValue ?? '',
      source: 'dataset',
      is_active: true,
      notes: null,
    })
  }

  return rows
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const supabaseKey = envValue('VITE_SUPABASE_ANON_KEY')

  if (!isDryRun && (!supabaseUrl || !supabaseKey)) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local / .env')
  }

  const baseUrl = supabaseUrl ? supabaseUrl.replace(/\/$/, '') : null
  const contentUrl = baseUrl ? `${baseUrl}/rest/v1/problem_content` : null
  const casesUrl = baseUrl ? `${baseUrl}/rest/v1/problem_test_cases` : null

  const roadmapPath = path.join(workspaceRoot, 'dsa-companions.json')
  const trainPath =
    envValue('LEETCODE_DATASET_TRAIN_PATH') ??
    path.resolve(workspaceRoot, '..', 'LeetCodeDataset-train.jsonl')
  const testPath =
    envValue('LEETCODE_DATASET_TEST_PATH') ??
    path.resolve(workspaceRoot, '..', 'LeetCodeDataset-test.jsonl')

  const roadmapByLc = loadRoadmapProblems(roadmapPath)
  const datasetById = await loadDatasetByQuestionId(trainPath, testPath)

  const problemLcs = Array.from(roadmapByLc.keys()).sort((left, right) => left - right)
  const existingContentByLc =
    isDryRun || !contentUrl ? new Map() : await loadExistingContentRows(contentUrl, supabaseKey, problemLcs)
  const contentRows = []
  const datasetCaseRows = []
  let matchedCount = 0

  for (const lc of problemLcs) {
    const roadmapProblem = roadmapByLc.get(lc)
    const datasetMatch = datasetById.get(lc) ?? null
    const existingRow = existingContentByLc.get(lc) ?? null

    if (datasetMatch) {
      matchedCount += 1
    }

    contentRows.push(toContentRow(roadmapProblem, datasetMatch, existingRow))
    datasetCaseRows.push(...toDatasetCaseRows(lc, datasetMatch))
  }

  const manualCount = contentRows.length - matchedCount

  if (isDryRun) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          roadmap_path: roadmapPath,
          train_path: trainPath,
          test_path: testPath,
          total_roadmap_problem_lcs: contentRows.length,
          matched_dataset_rows: matchedCount,
          manual_placeholder_rows: manualCount,
          dataset_test_cases_seeded: datasetCaseRows.length,
        },
        null,
        2,
      ),
    )
    return
  }

  for (const batch of chunk(contentRows, 10)) {
    await restRequest(`${contentUrl}?on_conflict=problem_lc`, supabaseKey, {
      method: 'POST',
      body: batch,
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    })
  }

  // Rebuild only dataset-sourced generated cases, keep manual cases untouched.
  for (const lcBatch of chunk(problemLcs, 50)) {
    const inClause = lcBatch.join(',')
    await restRequest(`${casesUrl}?source=eq.dataset&problem_lc=in.(${inClause})`, supabaseKey, {
      method: 'DELETE',
      headers: {
        Prefer: 'return=minimal',
      },
    })
  }

  for (const batch of chunk(datasetCaseRows, 200)) {
    await restRequest(casesUrl, supabaseKey, {
      method: 'POST',
      body: batch,
      headers: {
        Prefer: 'return=minimal',
      },
    })
  }

  const totalContentRows = await fetchExactCount(`${contentUrl}?select=problem_lc`, supabaseKey)
  const totalDatasetCases = await fetchExactCount(`${casesUrl}?select=id&source=eq.dataset`, supabaseKey)

  console.log(
    JSON.stringify(
      {
        total_roadmap_problem_lcs: contentRows.length,
        matched_dataset_rows: matchedCount,
        manual_placeholder_rows: manualCount,
        dataset_test_cases_seeded: datasetCaseRows.length,
        total_problem_content_rows: totalContentRows,
        total_dataset_test_case_rows: totalDatasetCases,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exitCode = 1
})
