import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
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

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const TABLE_CONFIGS = [
  { table: 'problem_content', key: 'content_id' },
  { table: 'problem_test_cases', key: 'id' },
  { table: 'code_runs', key: 'id', extra: ['track_key'] },
  { table: 'notes', key: 'id' },
  { table: 'solutions', key: 'id' },
  { table: 'resources', key: 'id' },
  { table: 'user_problem_overrides', key: 'id' },
  { table: 'problem_comments', key: 'id' },
  { table: 'shared_notes', key: 'id' },
  { table: 'shared_solutions', key: 'id' },
  { table: 'notifications', key: 'id', extra: ['track_key'] },
]

async function loadProblemMap(supabase) {
  const problemMap = new Map()
  let from = 0
  while (true) {
    const to = from + 999
    const { data, error } = await supabase
      .from('study_problems')
      .select('problem_lc,problem_key,track_key')
      .not('problem_lc', 'is', null)
      .range(from, to)
    if (error) throw error
    for (const row of data ?? []) {
      if (row.problem_lc != null && row.problem_key) {
        problemMap.set(Number(row.problem_lc), {
          problem_key: row.problem_key,
          track_key: row.track_key ?? null,
        })
      }
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  return problemMap
}

async function countMissing(supabase, table, extra = []) {
  let query = supabase.from(table).select('problem_lc,problem_key', { count: 'exact', head: true }).is('problem_key', null).not('problem_lc', 'is', null)
  if (extra.includes('track_key')) {
    query = supabase
      .from(table)
      .select('problem_lc,problem_key,track_key', { count: 'exact', head: true })
      .or('problem_key.is.null,track_key.is.null')
      .not('problem_lc', 'is', null)
  }
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

async function backfillTable(supabase, problemMap, config) {
  const { table, key, extra = [] } = config
  const selectCols = [key, 'problem_lc', 'problem_key', ...extra].join(',')
  const touched = 0

  let rows = []
  let from = 0
  while (true) {
    let query = supabase.from(table).select(selectCols)
    if (extra.includes('track_key')) {
      query = query.or('problem_key.is.null,track_key.is.null').not('problem_lc', 'is', null)
    } else {
      query = query.is('problem_key', null).not('problem_lc', 'is', null)
    }
    const { data, error } = await query.range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }

  let updated = 0

  for (const batch of chunk(rows, 100)) {
    for (const row of batch) {
      const mapping = problemMap.get(Number(row.problem_lc))
      if (!mapping?.problem_key) continue
      const payload = {}
      if (!row.problem_key) payload.problem_key = mapping.problem_key
      if (extra.includes('track_key') && !row.track_key) payload.track_key = mapping.track_key
      if (!Object.keys(payload).length) continue

      const { error } = await supabase.from(table).update(payload).eq(key, row[key])
      if (error) throw error
      updated += 1
    }
  }

  return { table, scanned: rows.length, updated }
}

async function backfillProgress(supabase, problemMap) {
  let rows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('progress')
      .select('user_key,problem_lc,problem_key')
      .is('problem_key', null)
      .not('problem_lc', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }

  let updated = 0
  for (const row of rows) {
    const mapping = problemMap.get(Number(row.problem_lc))
    if (!mapping?.problem_key) continue
    const { error } = await supabase
      .from('progress')
      .update({ problem_key: mapping.problem_key })
      .eq('user_key', row.user_key)
      .eq('problem_lc', row.problem_lc)
    if (error) throw error
    updated += 1
  }
  return { table: 'progress', scanned: rows.length, updated }
}

async function main() {
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const problemMap = await loadProblemMap(supabase)

  const before = {}
  for (const config of TABLE_CONFIGS) {
    before[config.table] = await countMissing(supabase, config.table, config.extra)
  }
  before.progress = await countMissing(supabase, 'progress')

  const results = []
  results.push(await backfillProgress(supabase, problemMap))
  for (const config of TABLE_CONFIGS) {
    results.push(await backfillTable(supabase, problemMap, config))
  }

  const after = {}
  for (const config of TABLE_CONFIGS) {
    after[config.table] = await countMissing(supabase, config.table, config.extra)
  }
  after.progress = await countMissing(supabase, 'progress')

  console.log(JSON.stringify({ before, results, after }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
