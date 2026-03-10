import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_PAYLOAD = path.join(projectRoot, 'out/sql-import/sql-import-payload.json')

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

function parseArgs(argv) {
  let payloadPath = DEFAULT_PAYLOAD
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--payload' && next) {
      payloadPath = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length).trim()
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
    }
  }

  return {
    payloadPath: path.resolve(payloadPath),
    dryRun,
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

async function main() {
  const { payloadPath, dryRun } = parseArgs(process.argv.slice(2))
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
  const studyTracks = ensureArray(payload.study_tracks)
  const studyModules = ensureArray(payload.study_modules)
  const studyProblems = ensureArray(payload.study_problems)
  const problemContent = ensureArray(payload.problem_content)
  const sqlProblemSpecs = ensureArray(payload.sql_problem_specs)
  const sqlProblemFixtures = ensureArray(payload.sql_problem_fixtures)
  const sqlProblemReferenceSolutions = ensureArray(payload.sql_problem_reference_solutions)

  const problemKeys = studyProblems.map((row) => row.problem_key)
  const fixtureProblemKeys = Array.from(new Set(sqlProblemFixtures.map((row) => row.problem_key)))

  const summary = {
    payloadPath,
    dryRun,
    counts: {
      study_tracks: studyTracks.length,
      study_modules: studyModules.length,
      study_problems: studyProblems.length,
      problem_content: problemContent.length,
      sql_problem_specs: sqlProblemSpecs.length,
      sql_problem_fixtures: sqlProblemFixtures.length,
      sql_problem_reference_solutions: sqlProblemReferenceSolutions.length,
    },
    problemKeys,
  }

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: trackError } = await supabase
    .from('study_tracks')
    .upsert(studyTracks, { onConflict: 'key' })
  if (trackError) throw trackError

  const { error: moduleError } = await supabase
    .from('study_modules')
    .upsert(studyModules, { onConflict: 'track_key,module_key' })
  if (moduleError) throw moduleError

  const { data: modules, error: moduleFetchError } = await supabase
    .from('study_modules')
    .select('id,module_key')
    .eq('track_key', 'sql')
  if (moduleFetchError) throw moduleFetchError

  const moduleIdByKey = new Map((modules ?? []).map((row) => [row.module_key, row.id]))
  const studyProblemRows = studyProblems.map((row) => ({
    problem_key: row.problem_key,
    problem_lc: row.problem_lc,
    track_key: row.track_key,
    module_id: moduleIdByKey.get(row.module_key) ?? null,
    source_type: row.source_type,
    source_platform: row.source_platform,
    source_problem_id: row.source_problem_id,
    title: row.title,
    slug: row.slug,
    difficulty: row.difficulty,
    tier: row.tier,
    phase_order: row.phase_order,
    study_order: row.study_order,
    curation_source: row.curation_source,
    category: row.category,
    companies: row.companies,
    leetcode_url: row.leetcode_url,
    neetcode_url: row.neetcode_url,
    is_active: row.is_active,
    canonical_source_url: row.canonical_source_url,
    source_url: row.source_url,
    faang_verification: row.faang_verification,
    inclusion_rationale: row.inclusion_rationale,
  }))

  const { error: problemError } = await supabase
    .from('study_problems')
    .upsert(studyProblemRows, { onConflict: 'problem_key' })
  if (problemError) throw problemError

  if (problemKeys.length > 0) {
    const { error: deleteContentError } = await supabase
      .from('problem_content')
      .delete()
      .in('problem_key', problemKeys)
    if (deleteContentError) throw deleteContentError
  }

  if (problemContent.length > 0) {
    const { error: contentInsertError } = await supabase
      .from('problem_content')
      .insert(problemContent)
    if (contentInsertError) throw contentInsertError
  }

  const { error: specError } = await supabase
    .from('sql_problem_specs')
    .upsert(sqlProblemSpecs, { onConflict: 'problem_key' })
  if (specError) throw specError

  const { error: refError } = await supabase
    .from('sql_problem_reference_solutions')
    .upsert(sqlProblemReferenceSolutions, { onConflict: 'problem_key' })
  if (refError) throw refError

  if (fixtureProblemKeys.length > 0) {
    const { error: deleteFixtureError } = await supabase
      .from('sql_problem_fixtures')
      .delete()
      .in('problem_key', fixtureProblemKeys)
    if (deleteFixtureError) throw deleteFixtureError
  }

  if (sqlProblemFixtures.length > 0) {
    const { error: fixtureError } = await supabase
      .from('sql_problem_fixtures')
      .insert(sqlProblemFixtures)
    if (fixtureError) throw fixtureError
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
