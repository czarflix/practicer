import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const corpusPath = path.resolve(projectRoot, '../sql-rebuild/out/corpus_expanded_candidates.json')
const defaultOutPath = path.resolve(projectRoot, 'out/sql-import/sql-runner-smoke.json')

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

const localEnv = {
  ...loadDotEnv(path.join(projectRoot, '.env')),
  ...loadDotEnv(path.join(projectRoot, '.env.local')),
}

function envValue(key, fallback = '') {
  return process.env[key] || localEnv[key] || fallback
}

function parseArgs(argv) {
  const options = {
    runnerUrl: envValue('VITE_RUNNER_API_URL', 'https://runner.czarflix.me'),
    userKey: envValue('SQL_SMOKE_USER_KEY', 'AYAAN'),
    outPath: defaultOutPath,
    pollMs: 1500,
    timeoutMs: 120000,
    includeSubmit: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--runner-url' && next) {
      options.runnerUrl = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--runner-url=')) {
      options.runnerUrl = arg.slice('--runner-url='.length).trim()
      continue
    }
    if (arg === '--user-key' && next) {
      options.userKey = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--user-key=')) {
      options.userKey = arg.slice('--user-key='.length).trim()
      continue
    }
    if (arg === '--out' && next) {
      options.outPath = path.resolve(next.trim())
      index += 1
      continue
    }
    if (arg.startsWith('--out=')) {
      options.outPath = path.resolve(arg.slice('--out='.length).trim())
      continue
    }
    if (arg === '--poll-ms' && next) {
      options.pollMs = Number(next)
      index += 1
      continue
    }
    if (arg.startsWith('--poll-ms=')) {
      options.pollMs = Number(arg.slice('--poll-ms='.length))
      continue
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number(next)
      index += 1
      continue
    }
    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length))
      continue
    }
    if (arg === '--include-submit') {
      options.includeSubmit = true
      continue
    }
  }

  options.runnerUrl = options.runnerUrl.replace(/\/+$/, '')
  options.pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0 ? options.pollMs : 1500
  options.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120000
  return options
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertProblem(row, key) {
  if (!row) throw new Error(`Problem not found in corpus: ${key}`)
  if (!row.reference_sql_runtime) throw new Error(`Problem missing reference_sql_runtime: ${key}`)
  if (!Array.isArray(row.fixtures) || row.fixtures.length === 0) throw new Error(`Problem missing fixtures: ${key}`)
  return row
}

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return { response, body }
}

async function createRun({ runnerUrl, userKey, trackKey, problemKey, code, mode, selectedCaseIds }) {
  const payload = {
    user_key: userKey,
    problem_key: problemKey,
    track_key: trackKey,
    language: 'sql',
    mode,
    code,
  }
  if (mode === 'run' && Array.isArray(selectedCaseIds) && selectedCaseIds.length > 0) {
    payload.selected_case_ids = selectedCaseIds
  }

  const { response, body } = await fetchJson(`${runnerUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`POST /runs failed (${response.status}): ${JSON.stringify(body)}`)
  }

  if (!body?.id) {
    throw new Error(`POST /runs did not return run id: ${JSON.stringify(body)}`)
  }

  return body
}

async function waitForRun({ runnerUrl, userKey, runId, pollMs, timeoutMs }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const { response, body } = await fetchJson(`${runnerUrl}/runs/${runId}?user_key=${encodeURIComponent(userKey)}`)
    if (!response.ok) {
      throw new Error(`GET /runs/${runId} failed (${response.status}): ${JSON.stringify(body)}`)
    }
    const status = String(body?.status || '')
    if (['passed', 'failed', 'error', 'timeout'].includes(status)) {
      return body
    }
    await sleep(pollMs)
  }
  throw new Error(`Timed out waiting for run ${runId}`)
}

function summarizeCases(cases) {
  if (!Array.isArray(cases)) return { total: 0, passed: 0, failed: 0, errors: 0 }
  let passed = 0
  let failed = 0
  let errors = 0
  for (const item of cases) {
    if (item?.passed) passed += 1
    else failed += 1
    if (item?.error) errors += 1
  }
  return { total: cases.length, passed, failed, errors }
}

async function fetchSubmitSideEffects({ supabase, userKey, problemKey }) {
  const { data: progress, error: progressError } = await supabase
    .from('progress')
    .select('user_key,problem_key,problem_type,status,solved_at,last_reviewed')
    .eq('user_key', userKey)
    .eq('problem_key', problemKey)
    .maybeSingle()

  if (progressError) {
    throw progressError
  }

  const { data: notifications, error: notificationsError } = await supabase
    .from('notifications')
    .select('recipient_user_key,actor_user_key,type,problem_key,track_key,created_at')
    .eq('type', 'problem_solved')
    .eq('problem_key', problemKey)
    .eq('actor_user_key', userKey)
    .order('created_at', { ascending: false })
    .limit(5)

  if (notificationsError) {
    throw notificationsError
  }

  return {
    progress,
    notifications: notifications ?? [],
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')
  const rows = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))

  const supabase =
    options.includeSubmit && supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null

  const easy = assertProblem(rows.find((row) => row.problem_key === 'sql-leetcode-175'), 'sql-leetcode-175')
  const medium = assertProblem(
    rows.find((row) => row.problem_key === 'sql-datalemur-international-call-percentage'),
    'sql-datalemur-international-call-percentage',
  )
  const hard = assertProblem(rows.find((row) => row.problem_key === 'sql-leetcode-leetcode-569'), 'sql-leetcode-leetcode-569')

  const plan = [
    {
      name: 'easy-run',
      problem: easy,
      mode: 'run',
      selectedCaseIds: [],
      code: easy.reference_sql_runtime,
    },
    {
      name: 'medium-run',
      problem: medium,
      mode: 'run',
      selectedCaseIds: [],
      code: medium.reference_sql_runtime,
    },
    {
      name: 'medium-selected-run',
      problem: medium,
      mode: 'run',
      selectedCaseIds: medium.fixtures.slice(0, 2).map((fixture) => fixture.fixture_key),
      code: medium.reference_sql_runtime,
    },
    {
      name: 'hard-run',
      problem: hard,
      mode: 'run',
      selectedCaseIds: [],
      code: hard.reference_sql_runtime,
    },
  ]

  if (options.includeSubmit) {
    plan.push({
      name: 'easy-submit',
      problem: easy,
      mode: 'submit',
      selectedCaseIds: [],
      code: easy.reference_sql_runtime,
    })
  }

  const report = {
    runner_url: options.runnerUrl,
    user_key: options.userKey,
    generated_at: new Date().toISOString(),
    poll_ms: options.pollMs,
    timeout_ms: options.timeoutMs,
    checks: [],
  }

  const health = await fetchJson(`${options.runnerUrl}/healthz`)
  report.health = {
    status: health.response.status,
    ok: health.response.ok,
    body: health.body,
  }
  if (!health.response.ok) {
    throw new Error(`Runner health check failed: ${JSON.stringify(report.health)}`)
  }

  for (const item of plan) {
    const created = await createRun({
      runnerUrl: options.runnerUrl,
      userKey: options.userKey,
      trackKey: 'sql',
      problemKey: item.problem.problem_key,
      code: item.code,
      mode: item.mode,
      selectedCaseIds: item.selectedCaseIds,
    })

    const finalRun = await waitForRun({
      runnerUrl: options.runnerUrl,
      userKey: options.userKey,
      runId: created.id,
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs,
    })

    const check = {
      name: item.name,
      problem_key: item.problem.problem_key,
      title: item.problem.title,
      mode: item.mode,
      requested_case_ids: item.selectedCaseIds,
      run_id: created.id,
      final_status: finalRun.status,
      tests_total: finalRun.tests_total,
      tests_passed: finalRun.tests_passed,
      summary: finalRun.summary,
      runner_meta: finalRun.runner_meta,
      verdict_summary: summarizeCases(finalRun?.verdict?.cases),
    }

    if (item.mode === 'submit' && supabase) {
      check.side_effects = await fetchSubmitSideEffects({
        supabase,
        userKey: options.userKey,
        problemKey: item.problem.problem_key,
      })
    }

    report.checks.push(check)
  }

  report.ok = report.checks.every((check) => {
    if (check.final_status !== 'passed') {
      return false
    }
    if (check.mode !== 'submit') {
      return true
    }
    return check.side_effects?.progress?.status === 'solved'
  })

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true })
  fs.writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
