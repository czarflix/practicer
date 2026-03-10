import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  deriveProblemEntryPoint,
  normalizeProblemDescriptionForStorage,
  normalizeProblemExamplesForStorage,
} from '../src/lib/problem-content.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const FINAL_IDS = [
  117, 133, 138, 142, 146, 155, 208, 211, 235, 271, 285, 295, 297, 355,
  372, 430, 449, 460, 652, 703, 715, 716, 731, 911, 981, 1244, 2013,
]
const GENERIC_TRIM_IDS = new Set([981, 1244, 2013])
const KNOWN_BAD_GENERIC_CASES = new Map([[981, new Set([2, 15])]])

const MAX_CONTENT_EXAMPLES = 4
const MAX_DATASET_HARNESS_CHARS = 250_000
const MAX_GENERIC_TEST_CASE_CHARS = 100_000

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const values = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
  return baseEnv[key]
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeInputOutput(raw) {
  return normalizeProblemExamplesForStorage(raw)
}

function trimTestRowsForGenericFallback(testRows) {
  return testRows.filter((item) => {
    const inputLength = String(item?.input_text || '').length
    const outputLength = String(item?.expected_output || '').length
    return inputLength + outputLength <= MAX_GENERIC_TEST_CASE_CHARS
  })
}

function buildContentPayload(problem, row) {
  const inputOutput = normalizeInputOutput(row.input_output)
  const normalizedEntryPoint = deriveProblemEntryPoint(row.entry_point || '', row.starter_code || '')
  const rawHarness = String(row.test || '')
  const safeHarness =
    GENERIC_TRIM_IDS.has(problem.lc) && rawHarness.length > MAX_DATASET_HARNESS_CHARS ? '' : rawHarness

  return {
    problem_lc: problem.lc,
    task_id: row.task_id || row.slug || `lc-${problem.lc}`,
    title: problem.title,
    difficulty: row.difficulty || problem.difficulty || 'Medium',
    tags: normalizeArray(row.tags),
    problem_description: normalizeProblemDescriptionForStorage(row.problem_description || ''),
    starter_code: row.starter_code || '',
    entry_point: normalizedEntryPoint,
    dataset_test_harness: safeHarness,
    input_output: inputOutput.slice(0, MAX_CONTENT_EXAMPLES),
    source: 'dataset',
    dataset_split: null,
  }
}

function buildTestCaseRows(problemLc, row, { hasDatasetHarness }) {
  const inputOutput = normalizeInputOutput(row.input_output)
  const rows = inputOutput.map((item, index) => ({
    problem_lc: problemLc,
    input_text: item.input,
    expected_output: item.output,
    sort_order: index + 1,
    raw_sort_order: index + 1,
    is_active: true,
    source: 'dataset',
    notes: null,
  }))

  if (hasDatasetHarness || !GENERIC_TRIM_IDS.has(problemLc)) {
    return rows.map(({ raw_sort_order, ...item }) => item)
  }

  const excludedOrders = KNOWN_BAD_GENERIC_CASES.get(problemLc) ?? new Set()
  const filteredRows = trimTestRowsForGenericFallback(rows).filter((item) => !excludedOrders.has(item.raw_sort_order))

  return filteredRows.map(({ raw_sort_order, ...item }, index) => ({
    ...item,
    sort_order: index + 1,
  }))
}

async function main() {
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const datasetPath = path.join(projectRoot, 'src', 'final_dataset.json')
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`final_dataset.json not found at ${datasetPath}`)
  }

  const rawDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'))
  const datasetByLc = new Map(
    rawDataset
      .map((row) => [Number(row.question_id || row.leetcode_id), row])
      .filter(([lc]) => Number.isFinite(lc) && FINAL_IDS.includes(lc)),
  )

  if (datasetByLc.size !== FINAL_IDS.length) {
    const missing = FINAL_IDS.filter((id) => !datasetByLc.has(id))
    throw new Error(`final_dataset.json is missing expected IDs: ${missing.join(', ')}`)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: problems, error: problemError } = await supabase
    .from('v_study_problems')
    .select('problem_lc,title,difficulty')

  if (problemError) {
    throw problemError
  }

  const problemMap = new Map()
  for (const row of problems || []) {
    if (Number.isFinite(Number(row.problem_lc)) && FINAL_IDS.includes(Number(row.problem_lc))) {
      problemMap.set(Number(row.problem_lc), {
        lc: Number(row.problem_lc),
        title: row.title,
        difficulty: row.difficulty,
      })
    }
  }

  const summary = []
  let importedTestCount = 0

  for (const lc of FINAL_IDS) {
    const problem = problemMap.get(lc)
    const row = datasetByLc.get(lc)
    if (!problem || !row) {
      throw new Error(`Missing problem metadata or dataset row for LC ${lc}`)
    }

    const contentPayload = buildContentPayload(problem, row)
    const testRows = buildTestCaseRows(lc, row, {
      hasDatasetHarness: Boolean(contentPayload.dataset_test_harness),
    })

    const { error: contentError } = await supabase.from('problem_content').upsert(contentPayload, {
      onConflict: 'problem_lc',
    })
    if (contentError) {
      throw new Error(`LC ${lc} content upsert failed: ${contentError.message}`)
    }

    const { error: deleteTestsError } = await supabase.from('problem_test_cases').delete().eq('problem_lc', lc)
    if (deleteTestsError) {
      throw new Error(`LC ${lc} test delete failed: ${deleteTestsError.message}`)
    }

    if (testRows.length > 0) {
      const { error: insertError } = await supabase.from('problem_test_cases').insert(testRows)
      if (insertError) {
        throw new Error(`LC ${lc} test insert failed: ${insertError.message}`)
      }
    }

    importedTestCount += testRows.length
    summary.push({
      problem_lc: contentPayload.problem_lc,
      entry_point: contentPayload.entry_point,
      has_harness: Boolean(contentPayload.dataset_test_harness),
      has_html: /<\s*\/?\s*[a-z][^>]*>/i.test(String(contentPayload.problem_description || '')),
      tests: testRows.length,
      examples: contentPayload.input_output.length,
    })
    console.log(`Imported LC ${lc} (${testRows.length} tests)`)
  }

  console.log(
    JSON.stringify(
      {
        imported_problem_count: summary.length,
        imported_test_case_count: importedTestCount,
        sample: summary.slice(0, 10),
      },
      null,
      2,
    ),
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
