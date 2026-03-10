import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_PRESENTATION = '/Users/czarflix/sql_metadata/sql_workspace_presentation/sql_workspace_presentation_verified.json'

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
  let presentationPath = DEFAULT_PRESENTATION
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--presentation' && next) {
      presentationPath = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--presentation=')) {
      presentationPath = arg.slice('--presentation='.length).trim()
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
    }
  }

  return {
    presentationPath: path.resolve(presentationPath),
    dryRun,
  }
}

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function main() {
  const { presentationPath, dryRun } = parseArgs(process.argv.slice(2))
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const presentationRows = JSON.parse(fs.readFileSync(presentationPath, 'utf8'))
  const updates = Array.isArray(presentationRows)
    ? presentationRows.map((row) => ({
        problem_key: row.problem_key,
        title: row.title,
        platform: row.platform,
        presentation: row.presentation,
      }))
    : []

  const summary = {
    presentationPath,
    dryRun,
    count: updates.length,
    problemKeys: updates.map((row) => row.problem_key),
  }

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const existingRows = new Map()
  const keyChunks = chunk(summary.problemKeys, 50)
  for (const keys of keyChunks) {
    const { data, error } = await supabase
      .from('problem_content')
      .select('problem_key')
      .in('problem_key', keys)

    if (error) {
      throw error
    }

    for (const row of data ?? []) {
      existingRows.set(row.problem_key, true)
    }
  }

  const missing = updates.filter((row) => !existingRows.has(row.problem_key)).map((row) => row.problem_key)
  if (missing.length > 0) {
    throw new Error(`Missing problem_content rows for ${missing.length} SQL problems: ${missing.slice(0, 10).join(', ')}`)
  }

  for (const row of updates) {
    const { error } = await supabase
      .from('problem_content')
      .update({ presentation: row.presentation })
      .eq('problem_key', row.problem_key)

    if (error) {
      throw error
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
