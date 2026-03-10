import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_OUT = path.join(projectRoot, 'out/sql-import/sql-pilot-validation.json')
const DEFAULT_USER_KEY = 'AYAAN'

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const values = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const splitIndex = line.indexOf('=')
    if (splitIndex <= 0) continue
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
  if (process.env[key]) return process.env[key]
  const localEnv = loadDotEnv(path.join(projectRoot, '.env.local'))
  if (localEnv[key]) return localEnv[key]
  const baseEnv = loadDotEnv(path.join(projectRoot, '.env'))
  return baseEnv[key]
}

function parseArgs(argv) {
  let outPath = DEFAULT_OUT
  let userKey = DEFAULT_USER_KEY

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--out' && next) {
      outPath = path.resolve(next.trim())
      index += 1
      continue
    }
    if (arg.startsWith('--out=')) {
      outPath = path.resolve(arg.slice('--out='.length).trim())
      continue
    }
    if (arg === '--user-key' && next) {
      userKey = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--user-key=')) {
      userKey = arg.slice('--user-key='.length).trim()
    }
  }

  return { outPath, userKey }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

async function count(client, table, filters = []) {
  let query = client.from(table).select('*', { head: true, count: 'exact' })
  for (const [type, column, value] of filters) {
    if (type === 'eq') query = query.eq(column, value)
    if (type === 'in' && Array.isArray(value) && value.length > 0) query = query.in(column, value)
  }
  const { count: rowCount, error } = await query
  if (error) throw error
  return rowCount ?? 0
}

async function main() {
  const { outPath, userKey } = parseArgs(process.argv.slice(2))
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sqlModules, error: moduleError } = await supabase
    .from('study_modules')
    .select('id,module_key,module_number,name')
    .eq('track_key', 'sql')
    .order('module_number', { ascending: true })

  if (moduleError) throw moduleError

  const phaseOneModules = (sqlModules ?? []).filter((row) => Number(row.module_number) === 1)
  const moduleIds = phaseOneModules.map((row) => row.id)

  const { data: studyProblems, error: studyProblemsError } = await supabase
    .from('study_problems')
    .select('problem_key,title,module_id,track_key,source_platform,source_problem_id')
    .eq('track_key', 'sql')
    .in('module_id', moduleIds)
    .order('study_order', { ascending: true })

  if (studyProblemsError) throw studyProblemsError

  const problemKeys = (studyProblems ?? []).map((row) => row.problem_key).filter(Boolean)
  const representativeKeys = [
    'sql-leetcode-175',
    'sql-datalemur-international-call-percentage',
    'sql-leetcode-leetcode-569',
  ].filter((key) => problemKeys.includes(key))

  const [
    studyProblemCount,
    vStudyProblemCount,
    contentCount,
    specCount,
    fixtureCount,
    referenceCount,
  ] = await Promise.all([
    count(supabase, 'study_problems', [['eq', 'track_key', 'sql'], ['in', 'module_id', moduleIds]]),
    count(supabase, 'v_study_problems', [['eq', 'track_key', 'sql'], ['in', 'module_id', moduleIds]]),
    count(supabase, 'problem_content', [['in', 'problem_key', problemKeys]]),
    count(supabase, 'sql_problem_specs', [['in', 'problem_key', problemKeys]]),
    count(supabase, 'sql_problem_fixtures', [['in', 'problem_key', problemKeys]]),
    count(supabase, 'sql_problem_reference_solutions', [['in', 'problem_key', problemKeys]]),
  ])

  const { data: representativeFixtures, error: representativeFixturesError } = await supabase
    .from('sql_problem_fixtures')
    .select('problem_key,fixture_key,is_public,comparison_mode,order_required')
    .in('problem_key', representativeKeys)
    .order('problem_key', { ascending: true })
    .order('sort_order', { ascending: true })

  if (representativeFixturesError) throw representativeFixturesError

  const { data: solvedProgress, error: solvedProgressError } = await supabase
    .from('progress')
    .select('user_key,problem_key,problem_type,status,solved_at')
    .eq('user_key', userKey)
    .eq('problem_key', 'sql-leetcode-175')
    .maybeSingle()

  if (solvedProgressError) throw solvedProgressError

  const summary = {
    generated_at: new Date().toISOString(),
    user_key: userKey,
    phase_1_modules: phaseOneModules,
    counts: {
      study_problems: studyProblemCount,
      v_study_problems: vStudyProblemCount,
      problem_content: contentCount,
      sql_problem_specs: specCount,
      sql_problem_fixtures: fixtureCount,
      sql_problem_reference_solutions: referenceCount,
    },
    representative_problems: (studyProblems ?? []).filter((row) => representativeKeys.includes(row.problem_key)),
    representative_fixtures: representativeFixtures ?? [],
    solved_progress_example: solvedProgress,
    ok:
      studyProblemCount > 0 &&
      studyProblemCount === vStudyProblemCount &&
      studyProblemCount === contentCount &&
      studyProblemCount === specCount &&
      studyProblemCount === referenceCount &&
      fixtureCount > 0 &&
      solvedProgress?.status === 'solved',
  }

  ensureDir(outPath)
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
