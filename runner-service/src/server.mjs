import http from 'node:http'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import {
  authenticateAssistantRequest,
  createAssistantThread,
  deleteAssistantCredential,
  getAssistantCredentialSummary,
  listAssistantMessages,
  listAssistantThreads,
  saveAssistantCredential,
  streamAssistantReply,
  updateAssistantThread,
} from './assistant-service.mjs'
import { buildDatasetHarness, buildPythonHarness, parseHarnessResult } from './harness.mjs'
import { validateConfig, runnerConfig } from './config.mjs'
import { runOnJudge0 } from './judge0.mjs'
import { loadSqlProblem } from './corpus-loader.mjs'
import { executeSql } from './sql-runner.mjs'

validateConfig()

const FINAL_STATUSES = new Set(['passed', 'failed', 'error', 'timeout'])

const supabase = createClient(runnerConfig.supabaseUrl, runnerConfig.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

function toSafeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getAllowedOrigin(requestOrigin) {
  const origins = runnerConfig.allowedOrigins
  if (origins.has('*')) return '*'
  if (!requestOrigin) return null
  const cleaned = requestOrigin.trim().replace(/\/+$/, '')
  return origins.has(cleaned) ? cleaned : null
}

function setCorsHeaders(req, res) {
  const requestOrigin = req.headers.origin
  const origin = getAllowedOrigin(requestOrigin)

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.setHeader('Vary', 'Origin')
}

function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res)
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function sendError(req, res, statusCode, message) {
  sendJson(req, res, statusCode, { error: message })
}

function beginEventStream(req, res) {
  setCorsHeaders(req, res)
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
}

function writeEvent(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`)
}

async function readJsonBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body.')
  }
}

function statusFromHarness(value) {
  const normalized = String(value || '').toLowerCase()
  if (FINAL_STATUSES.has(normalized)) {
    return normalized
  }
  return 'error'
}

function normalizeUserKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

function deriveUserKey(displayName, email) {
  return normalizeUserKey(displayName) || normalizeUserKey(String(email || '').split('@')[0])
}

function normalizeDisplayName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function buildTemporaryPassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = randomBytes(length)
  let password = ''
  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length]
  }
  return password
}

function statusCodeForUserProvisionError(error) {
  const source = String(error?.message || error?.error_description || error?.details || '').toLowerCase()
  if (
    /already registered|already exists|duplicate|unique|violates unique constraint|23505/.test(source)
  ) {
    return 409
  }

  if (/invalid email|password/.test(source)) {
    return 400
  }

  return 500
}

function logAdminDeleteFailure(level, details) {
  const logger = level === 'error' ? console.error : console.warn
  logger('[admin-user-delete] ' + JSON.stringify(details))
}

function looksLikeGenericCaseValue(value) {
  const source = String(value || '').trim()
  if (!source) {
    return true
  }

  if (source.includes('=')) {
    return true
  }

  try {
    JSON.parse(source)
    return true
  } catch {
    return /^(?:-?\d|true|false|True|False|null|None|".*"|'.*'|\[|\{|\()/.test(source)
  }
}

function shouldUseGenericHarness(datasetTestHarness, tests) {
  const harnessSource = String(datasetTestHarness || '')
  if (!harnessSource.trim()) {
    return true
  }

  const customHarnessSignals = [
    /class\s+TreeNode\b/,
    /class\s+ListNode\b/,
    /class\s+Node\b/,
    /build_[A-Za-z0-9_]+\(/,
    /serialize_[A-Za-z0-9_]+\(/,
    /is_same_(?:tree|list)\(/,
    /UndirectedGraphNode/,
    /RandomListNode/,
  ]

  if (customHarnessSignals.some((pattern) => pattern.test(harnessSource))) {
    return false
  }

  return (tests || []).every(
    (test) => looksLikeGenericCaseValue(test?.input_text) && looksLikeGenericCaseValue(test?.expected_output),
  )
}

async function resolveProblemType(problemLc) {
  const { data, error } = await supabase
    .from('problems')
    .select('nc_lc,cp_lc')
    .or(`nc_lc.eq.${problemLc},cp_lc.eq.${problemLc}`)
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return 'neetcode'
  }

  return Number(data.nc_lc) === Number(problemLc) ? 'neetcode' : 'companion'
}

function buildSummaryFromRun(runRow) {
  const passed = toSafeNumber(runRow?.tests_passed)
  const total = toSafeNumber(runRow?.tests_total)

  if (passed !== null && total !== null) {
    return `${passed}/${total} tests passed`
  }

  if (runRow?.status === 'timeout') {
    return 'Execution timed out.'
  }

  if (runRow?.stderr) {
    return String(runRow.stderr).slice(0, 500)
  }

  if (runRow?.compile_output) {
    return String(runRow.compile_output).slice(0, 500)
  }

  if (runRow?.verdict?.message) {
    return String(runRow.verdict.message)
  }

  const firstFailedMessage = String(runRow?.verdict?.first_failed_case?.message || '').trim()
  if (firstFailedMessage) {
    return firstFailedMessage
  }

  return runRow?.status ? String(runRow.status) : 'Run queued.'
}

async function markProgressSolved(userKey, problemLc, problemKey = null) {
  const nowIso = new Date().toISOString()
  const problemType = await resolveProblemType(problemLc)

  let existingQuery = supabase.from('progress').select('*').eq('user_key', userKey)
  existingQuery = problemKey ? existingQuery.eq('problem_key', problemKey) : existingQuery.eq('problem_lc', problemLc)

  const { data: existing, error: existingError } = await existingQuery.maybeSingle()

  if (existingError) {
    throw existingError
  }

  const payload = {
    user_key: userKey,
    problem_key: problemKey,
    problem_lc: problemLc,
    problem_type: existing?.problem_type || problemType,
    status: 'solved',
    difficulty_rating: existing?.difficulty_rating ?? null,
    time_spent: existing?.time_spent ?? 0,
    solved_at: existing?.solved_at || nowIso,
    last_reviewed: nowIso,
    is_bookmarked: existing?.is_bookmarked ?? false,
  }

  if (existing) {
    let updateQuery = supabase.from('progress').update(payload).eq('user_key', userKey)
    updateQuery = problemKey ? updateQuery.eq('problem_key', problemKey) : updateQuery.eq('problem_lc', problemLc)
    const { error } = await updateQuery
    if (error) {
      throw error
    }
  } else {
    const { error } = await supabase.from('progress').insert(payload)
    if (error) {
      throw error
    }
  }
}

// ─── SQL progress tracking ───────────────────────────────────────────────────

async function markSqlProgressSolved(userKey, problemKey) {
  const nowIso = new Date().toISOString()

  const { data: existing, error: existingError } = await supabase
    .from('progress')
    .select('*')
    .eq('user_key', userKey)
    .eq('problem_key', problemKey)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  const payload = {
    user_key: userKey,
    problem_key: problemKey,
    problem_lc: null,
    problem_type: 'sql',
    status: 'solved',
    difficulty_rating: existing?.difficulty_rating ?? null,
    time_spent: existing?.time_spent ?? 0,
    solved_at: existing?.solved_at || nowIso,
    last_reviewed: nowIso,
    is_bookmarked: existing?.is_bookmarked ?? false,
  }

  if (existing) {
    const { error } = await supabase
      .from('progress')
      .update(payload)
      .eq('user_key', userKey)
      .eq('problem_key', problemKey)
    if (error) throw error
  } else {
    const { error } = await supabase.from('progress').insert(payload)
    if (error) throw error
  }
}

// ─── SQL background processor ─────────────────────────────────────────────────

async function processSqlRun({ runId, userKey, problemKey, trackKey, mode, solutionId, selectedCaseIds, code, spec }) {
  const startedAt = new Date().toISOString()

  try {
    const { error: startError } = await supabase
      .from('code_runs')
      .update({ status: 'running', started_at: startedAt })
      .eq('id', runId)
      .eq('user_key', userKey)

    if (startError) {
      throw startError
    }

    // submit = run all fixtures; run = run selected (or all if none specified)
    const caseResults = await executeSql({
      userSql: code,
      submissionKind: spec.submission_kind,
      fixtures: spec.fixtures,
      selectedCaseIds: mode === 'run' ? selectedCaseIds : null,
    })

    const testsPassed = caseResults.filter((r) => r.passed).length
    const testsTotal = caseResults.length
    const finalStatus = testsPassed === testsTotal ? 'passed' : 'failed'
    const finishedAt = new Date().toISOString()

    const { error: finishError } = await supabase
      .from('code_runs')
      .update({
        status: finalStatus,
        tests_total: testsTotal,
        tests_passed: testsPassed,
        verdict: {
          status: finalStatus,
          tests_passed: testsPassed,
          tests_total: testsTotal,
          cases: caseResults,
        },
        runner_meta: {
          mode,
          solution_id: solutionId,
          track_key: trackKey,
          language: 'sql',
          submission_kind: spec.submission_kind,
          selected_case_ids: selectedCaseIds,
        },
        finished_at: finishedAt,
      })
      .eq('id', runId)
      .eq('user_key', userKey)

    if (finishError) {
      throw finishError
    }

    if (mode === 'submit' && finalStatus === 'passed') {
      await markSqlProgressSolved(userKey, problemKey)
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()

    await supabase
      .from('code_runs')
      .update({
        status: 'error',
        stderr: error instanceof Error ? error.message : String(error),
        runner_meta: {
          mode,
          track_key: trackKey,
          language: 'sql',
          processing_error: error instanceof Error ? error.message : String(error),
        },
        finished_at: finishedAt,
      })
      .eq('id', runId)
      .eq('user_key', userKey)
      .then(() => undefined)
      .catch(() => undefined)
  }
}

// ─── SQL run creation ─────────────────────────────────────────────────────────

async function createSqlRun(req, res, body) {
  const userKey = String(body?.user_key || '').trim()
  const problemKey = String(body?.problem_key || '').trim()
  const trackKey = String(body?.track_key || 'sql').trim()
  const code = String(body?.code || '')
  const mode = body?.mode === 'submit' ? 'submit' : 'run'
  const solutionId = toSafeNumber(body?.solution_id)

  // selected_case_ids only applies to run mode; ignored for submit
  const selectedCaseIds =
    mode === 'run' && Array.isArray(body?.selected_case_ids)
      ? [...new Set(body.selected_case_ids.map((v) => String(v)).filter(Boolean))]
      : []

  if (!userKey) {
    sendError(req, res, 400, 'user_key is required.')
    return
  }

  if (!problemKey) {
    sendError(req, res, 400, 'problem_key is required.')
    return
  }

  if (!code.trim()) {
    sendError(req, res, 400, 'code is required.')
    return
  }

  if (code.length > runnerConfig.maxCodeChars) {
    sendError(req, res, 400, `code is too large (max ${runnerConfig.maxCodeChars} chars).`)
    return
  }

  try {
    const spec = await loadSqlProblem(problemKey, supabase)
    if (!spec || !spec.fixtures || spec.fixtures.length === 0) {
      sendError(req, res, 404, `SQL problem not found or has no fixtures: ${problemKey}`)
      return
    }

    // Validate selected_case_ids if specified
    if (mode === 'run' && selectedCaseIds.length > 0) {
      const validIds = new Set(spec.fixtures.map((f) => f.fixture_key))
      const notFound = selectedCaseIds.filter((id) => !validIds.has(id))
      if (notFound.length > 0) {
        sendError(req, res, 400, `selected_case_ids not found: ${notFound.join(', ')}`)
        return
      }
    }

    // Compute tests_total for the run record
    const fixturesForRun =
      mode === 'run' && selectedCaseIds.length > 0
        ? spec.fixtures.filter((f) => selectedCaseIds.includes(f.fixture_key))
        : spec.fixtures

    const { data: runRow, error: insertError } = await supabase
      .from('code_runs')
      .insert({
        user_key: userKey,
        problem_key: problemKey,
        problem_lc: null,
        track_key: trackKey,
        language: 'sql',
        submitted_code: code,
        status: 'queued',
        tests_total: fixturesForRun.length,
        tests_passed: 0,
        runner_meta: {
          mode,
          solution_id: solutionId,
          selected_case_ids: selectedCaseIds,
        },
      })
      .select('*')
      .single()

    if (insertError || !runRow) {
      throw insertError || new Error('Failed to create run row.')
    }

    sendJson(req, res, 201, {
      id: runRow.id,
      status: runRow.status,
      tests_total: runRow.tests_total,
    })

    void processSqlRun({
      runId: runRow.id,
      userKey,
      problemKey,
      trackKey,
      mode,
      solutionId,
      selectedCaseIds,
      code,
      spec,
    })
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to create SQL run.')
  }
}

async function processRun({  runId,
  userKey,
  problemLc,
  problemKey,
  mode,
  solutionId,
  focusedTestIds,
  code,
  entryPoint,
  datasetTestHarness,
  tests,
  useGenericHarness,
}) {
  const startedAt = new Date().toISOString()

  try {
    const { error: startError } = await supabase
      .from('code_runs')
      .update({ status: 'running', started_at: startedAt })
      .eq('id', runId)
      .eq('user_key', userKey)

    if (startError) {
      throw startError
    }

    const hasDatasetHarness = !useGenericHarness && String(datasetTestHarness || '').trim().length > 0
    const harness = hasDatasetHarness
      ? buildDatasetHarness({
          userCode: code,
          entryPoint,
          datasetTestHarness,
          tests,
        })
      : buildPythonHarness({
          userCode: code,
          entryPoint,
          tests,
        })

    const judge = await runOnJudge0(harness)
    const harnessResult = parseHarnessResult(judge.stdout)

    let finalStatus = judge.mappedStatus
    let testsTotal = tests.length
    let testsPassed = 0
    let verdict = {}

    if (judge.mappedStatus === 'passed') {
      if (!harnessResult) {
        finalStatus = 'error'
        verdict = {
          message: 'Harness result marker not found in Judge0 stdout.',
        }
      } else {
        finalStatus = statusFromHarness(harnessResult.status)
        testsTotal = toSafeNumber(harnessResult.tests_total) ?? tests.length
        testsPassed = toSafeNumber(harnessResult.tests_passed) ?? 0
        verdict = harnessResult
      }
    } else {
      verdict = {
        message:
          judge.message ||
          judge.stderr ||
          judge.compileOutput ||
          judge.judgeStatusDescription ||
          `Judge0 status id ${judge.judgeStatusId}`,
      }
    }

    const finishedAt = new Date().toISOString()

    const { error: finishError } = await supabase
      .from('code_runs')
      .update({
        status: finalStatus,
        stdout: judge.stdout || null,
        stderr: judge.stderr || null,
        compile_output: judge.compileOutput || null,
        judge_token: judge.judgeToken,
        runtime_ms: judge.runtimeMs,
        memory_kb: judge.memoryKb,
        tests_total: testsTotal,
        tests_passed: testsPassed,
        verdict,
        runner_meta: {
          mode,
          solution_id: solutionId,
          focused_test_ids: focusedTestIds,
          entry_point: entryPoint,
          harness_type: hasDatasetHarness ? 'dataset' : 'generic',
          judge_status_id: judge.judgeStatusId,
          judge_status: judge.judgeStatusDescription,
          judge_payload: judge.raw,
        },
        finished_at: finishedAt,
      })
      .eq('id', runId)
      .eq('user_key', userKey)

    if (finishError) {
      throw finishError
    }

    if (mode === 'submit' && finalStatus === 'passed') {
      await markProgressSolved(userKey, problemLc, problemKey)
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()

    await supabase
      .from('code_runs')
      .update({
        status: 'error',
        stderr: error instanceof Error ? error.message : String(error),
        runner_meta: {
          mode,
          solution_id: solutionId,
          focused_test_ids: focusedTestIds,
          entry_point: entryPoint,
          processing_error: error instanceof Error ? error.message : String(error),
        },
        finished_at: finishedAt,
      })
      .eq('id', runId)
      .eq('user_key', userKey)
      .then(() => undefined)
      .catch(() => undefined)
  }
}

async function createDsaRun(req, res, body) {
  const userKey = String(body?.user_key || '').trim()
  const problemLc = toSafeNumber(body?.problem_lc)
  const code = String(body?.code || '')
  const mode = body?.mode === 'submit' ? 'submit' : 'run'
  const solutionId = toSafeNumber(body?.solution_id)
  const requestedTestIds =
    mode === 'run' && Array.isArray(body?.test_ids)
      ? [...new Set(body.test_ids.map((value) => toSafeNumber(value)).filter((value) => Number.isFinite(value)))]
      : []

  if (!userKey) {
    sendError(req, res, 400, 'user_key is required.')
    return
  }

  if (!problemLc || problemLc <= 0) {
    sendError(req, res, 400, 'problem_lc must be a positive number.')
    return
  }

  if (!code.trim()) {
    sendError(req, res, 400, 'code is required.')
    return
  }

  if (code.length > runnerConfig.maxCodeChars) {
    sendError(req, res, 400, `code is too large (max ${runnerConfig.maxCodeChars} chars).`)
    return
  }

  try {
    const { data: content, error: contentError } = await supabase
      .from('problem_content')
      .select('problem_lc,problem_key,entry_point,dataset_test_harness')
      .eq('problem_lc', problemLc)
      .maybeSingle()

    if (contentError) {
      throw contentError
    }

    const problemKey = String(content?.problem_key || '').trim() || null
    const entryPoint = String(content?.entry_point || '').trim()
    if (!entryPoint) {
      sendError(req, res, 400, 'Problem does not have an entry_point configured.')
      return
    }

    const datasetTestHarness = String(content?.dataset_test_harness || '')

    const { data: tests, error: testsError } = await supabase
      .from('problem_test_cases')
      .select('id,sort_order,input_text,expected_output')
      .eq('problem_lc', problemLc)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(runnerConfig.maxTests)

    if (testsError) {
      throw testsError
    }

    if (!tests || tests.length === 0) {
      sendError(req, res, 400, 'No active test cases found for this problem.')
      return
    }

    const selectedTests =
      requestedTestIds.length > 0 ? tests.filter((test) => requestedTestIds.includes(Number(test.id))) : tests

    if (selectedTests.length === 0) {
      sendError(req, res, 400, 'Selected tests were not found for this problem.')
      return
    }

    const useGenericHarness = shouldUseGenericHarness(datasetTestHarness, selectedTests)

    if (requestedTestIds.length > 0 && !useGenericHarness) {
      sendError(req, res, 400, 'Focused run is not available for this problem yet.')
      return
    }

    const { data: runRow, error: insertError } = await supabase
      .from('code_runs')
      .insert({
        user_key: userKey,
        problem_key: problemKey,
        problem_lc: problemLc,
        track_key: 'dsa',
        language: 'python',
        submitted_code: code,
        status: 'queued',
        tests_total: selectedTests.length,
        tests_passed: 0,
        runner_meta: {
          mode,
          solution_id: solutionId,
          entry_point: entryPoint,
          harness_type: useGenericHarness ? 'generic' : 'dataset',
          focused_test_ids: requestedTestIds,
        },
      })
      .select('*')
      .single()

    if (insertError || !runRow) {
      throw insertError || new Error('Failed to create run row.')
    }

    sendJson(req, res, 201, {
      id: runRow.id,
      status: runRow.status,
      tests_total: runRow.tests_total,
    })

    void processRun({
      runId: runRow.id,
      userKey,
      problemLc,
      problemKey,
      mode,
      solutionId,
      focusedTestIds: requestedTestIds,
      code,
      entryPoint,
      datasetTestHarness,
      tests: selectedTests,
      useGenericHarness,
    })
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to create run.')
  }
}

async function getRun(req, res, runId, userKey) {
  if (!userKey) {
    sendError(req, res, 400, 'user_key query param is required.')
    return
  }

  const numericRunId = toSafeNumber(runId)
  if (!numericRunId) {
    sendError(req, res, 400, 'Invalid run id.')
    return
  }

  try {
    const { data, error } = await supabase
      .from('code_runs')
      .select('*')
      .eq('id', numericRunId)
      .eq('user_key', userKey)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      sendError(req, res, 404, 'Run not found.')
      return
    }

    sendJson(req, res, 200, {
      ...data,
      summary: buildSummaryFromRun(data),
      message: buildSummaryFromRun(data),
    })
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to fetch run.')
  }
}

async function requireAssistantAuth(req, res) {
  try {
    return await authenticateAssistantRequest(req, supabase)
  } catch (error) {
    sendError(req, res, 401, error instanceof Error ? error.message : 'Unauthorized.')
    return null
  }
}

async function requireAdminAuth(req, res) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return null
  }

  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('is_admin')
      .eq('user_key', auth.userKey)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data?.is_admin) {
      sendError(req, res, 403, 'Admin access is required.')
      return null
    }

    return auth
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to verify admin access.')
    return null
  }
}

async function handleAdminUserCreate(req, res) {
  const auth = await requireAdminAuth(req, res)
  if (!auth) {
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendError(req, res, 400, error instanceof Error ? error.message : 'Invalid request body.')
    return
  }

  const email = normalizeEmail(body?.email)
  const displayName = normalizeDisplayName(body?.display_name)
  const userKey = normalizeUserKey(body?.user_key) || deriveUserKey(displayName, email)
  const password = String(body?.password || '').trim() || buildTemporaryPassword()
  const isAdmin = body?.is_admin === true

  if (!email || !isValidEmail(email)) {
    sendError(req, res, 400, 'A valid email is required.')
    return
  }

  if (!displayName) {
    sendError(req, res, 400, 'display_name is required.')
    return
  }

  if (!userKey || userKey.length < 2) {
    sendError(req, res, 400, 'user_key must contain at least 2 letters or numbers.')
    return
  }

  if (password.length < 8) {
    sendError(req, res, 400, 'password must be at least 8 characters.')
    return
  }

  let createdAuthUserId = null

  try {
    const { data: authResult, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        user_key: userKey,
      },
      app_metadata: {
        practicer_role: isAdmin ? 'admin' : 'user',
      },
    })

    if (authError || !authResult?.user?.id) {
      const statusCode = statusCodeForUserProvisionError(authError)
      sendError(req, res, statusCode, authError?.message || 'Failed to create auth user.')
      return
    }

    createdAuthUserId = authResult.user.id

    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .insert({
        user_key: userKey,
        display_name: displayName,
        is_admin: isAdmin,
        auth_user_id: createdAuthUserId,
      })
      .select('user_key,display_name,is_admin,auth_user_id,created_at')
      .single()

    if (appUserError || !appUser) {
      throw appUserError || new Error('Failed to persist app user mapping.')
    }

    sendJson(req, res, 201, {
      user: {
        ...appUser,
        email,
      },
      credential: {
        email,
        password,
        generated: !String(body?.password || '').trim(),
      },
      created_by: auth.userKey,
    })
  } catch (error) {
    if (createdAuthUserId) {
      await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined)
    }

    const statusCode = statusCodeForUserProvisionError(error)
    sendError(req, res, statusCode, error instanceof Error ? error.message : 'Failed to create user.')
  }
}

async function handleAdminUserDelete(req, res, targetUserKey, url) {
  const auth = await requireAdminAuth(req, res)
  if (!auth) {
    return
  }

  const requestedUserKey = normalizeUserKey(decodeURIComponent(String(targetUserKey || '')))
  const providedAuthUserId = String(url.searchParams.get('auth_user_id') || '').trim()

  if (!requestedUserKey) {
    sendError(req, res, 400, 'user_key is required.')
    return
  }

  try {
    const [pathLookup, authLookup] = await Promise.all([
      supabase
        .from('app_users')
        .select('user_key,display_name,auth_user_id')
        .eq('user_key', requestedUserKey)
        .maybeSingle(),
      providedAuthUserId
        ? supabase
            .from('app_users')
            .select('user_key,display_name,auth_user_id')
            .eq('auth_user_id', providedAuthUserId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (pathLookup.error) {
      throw pathLookup.error
    }

    if (authLookup?.error) {
      throw authLookup.error
    }

    const pathUser = pathLookup.data ?? null
    const authUser = authLookup?.data ?? null
    if (providedAuthUserId && pathUser?.user_key && authUser?.user_key && pathUser.user_key !== authUser.user_key) {
      logAdminDeleteFailure('warn', {
        actor_user_key: auth.userKey,
        requested_user_key: requestedUserKey,
        provided_auth_user_id: providedAuthUserId,
        failure_reason: 'target_mismatch',
        path_user_key: pathUser.user_key,
        auth_user_key: authUser.user_key,
      })
      sendError(req, res, 409, 'Delete target mismatch.')
      return
    }

    const targetUser = providedAuthUserId ? authUser : pathUser
    if (!targetUser?.user_key) {
      logAdminDeleteFailure('warn', {
        actor_user_key: auth.userKey,
        requested_user_key: requestedUserKey,
        provided_auth_user_id: providedAuthUserId || null,
        failure_reason: 'not_found',
      })
      sendError(req, res, 404, 'User not found.')
      return
    }

    if (targetUser.user_key === auth.userKey) {
      logAdminDeleteFailure('warn', {
        actor_user_key: auth.userKey,
        requested_user_key: requestedUserKey,
        provided_auth_user_id: providedAuthUserId || null,
        failure_reason: 'self_delete_blocked',
        resolved_user_key: targetUser.user_key,
      })
      sendError(req, res, 400, 'You cannot delete your own admin account.')
      return
    }

    if (targetUser.auth_user_id) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(targetUser.auth_user_id)
      if (authDeleteError && !/not found/i.test(String(authDeleteError.message || ''))) {
        throw authDeleteError
      }
    }

    const { error: deleteError } = await supabase
      .from('app_users')
      .delete()
      .eq('user_key', targetUser.user_key)

    if (deleteError) {
      throw deleteError
    }

    sendJson(req, res, 200, {
      deleted_user_key: targetUser.user_key,
      display_name: targetUser.display_name,
    })
  } catch (error) {
    logAdminDeleteFailure('error', {
      actor_user_key: auth.userKey,
      requested_user_key: requestedUserKey,
      provided_auth_user_id: providedAuthUserId || null,
      failure_reason: 'delete_failed',
      message: error instanceof Error ? error.message : 'Failed to delete user.',
    })
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to delete user.')
  }
}

async function handleAssistantThreadsList(req, res, url) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  const problemKey = String(url.searchParams.get('problem_key') || '').trim()
  if (!problemKey) {
    sendError(req, res, 400, 'problem_key query param is required.')
    return
  }

  try {
    const data = await listAssistantThreads({
      supabase,
      userKey: auth.userKey,
      problemKey,
    })
    sendJson(req, res, 200, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to load threads.')
  }
}

async function handleAssistantThreadCreate(req, res) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  try {
    const body = await readJsonBody(req)
    const problemKey = String(body?.problem_key || '').trim()
    const trackKey = String(body?.track_key || 'dsa').trim()
    if (!problemKey) {
      sendError(req, res, 400, 'problem_key is required.')
      return
    }

    const data = await createAssistantThread({
      supabase,
      userKey: auth.userKey,
      problemKey,
      trackKey,
      title: body?.title,
      providerMode: body?.provider_mode,
    })
    sendJson(req, res, 201, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to create thread.')
  }
}

async function handleAssistantThreadUpdate(req, res, threadId) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  const numericThreadId = toSafeNumber(threadId)
  if (!numericThreadId) {
    sendError(req, res, 400, 'Invalid thread id.')
    return
  }

  try {
    const body = await readJsonBody(req)
    const data = await updateAssistantThread({
      supabase,
      userKey: auth.userKey,
      threadId: numericThreadId,
      patch: body,
    })
    sendJson(req, res, 200, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to update thread.')
  }
}

async function handleAssistantMessagesList(req, res, threadId) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  const numericThreadId = toSafeNumber(threadId)
  if (!numericThreadId) {
    sendError(req, res, 400, 'Invalid thread id.')
    return
  }

  try {
    const data = await listAssistantMessages({
      supabase,
      userKey: auth.userKey,
      threadId: numericThreadId,
    })
    sendJson(req, res, 200, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to load messages.')
  }
}

async function handleAssistantMessageStream(req, res, threadId) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  const numericThreadId = toSafeNumber(threadId)
  if (!numericThreadId) {
    sendError(req, res, 400, 'Invalid thread id.')
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendError(req, res, 400, error instanceof Error ? error.message : 'Invalid request body.')
    return
  }

  beginEventStream(req, res)
  writeEvent(res, { type: 'status', stage: 'accepted', message: 'Assistant request accepted.' })

  try {
    await streamAssistantReply({
      supabase,
      userKey: auth.userKey,
      threadId: numericThreadId,
      message: body?.message,
      intent: body?.intent,
      attachments: body?.attachments || {},
      editorSnapshot: body?.editor_snapshot || '',
      noteSnapshot: body?.note_snapshot || null,
      onEvent: (payload) => {
        writeEvent(res, payload)
      },
    })
    writeEvent(res, { type: 'done' })
  } catch (error) {
    writeEvent(res, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Assistant request failed.',
    })
  } finally {
    res.end()
  }
}

async function handleAssistantCredentialsGet(req, res) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  try {
    const data = await getAssistantCredentialSummary({
      supabase,
      userKey: auth.userKey,
    })
    sendJson(req, res, 200, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to load AI credentials.')
  }
}

async function handleAssistantCredentialsSave(req, res) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  try {
    const body = await readJsonBody(req)
    const data = await saveAssistantCredential({
      supabase,
      userKey: auth.userKey,
      apiKey: body?.api_key,
      label: body?.label,
    })
    sendJson(req, res, 201, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to save AI credential.')
  }
}

async function handleAssistantCredentialsDelete(req, res, credentialId) {
  const auth = await requireAssistantAuth(req, res)
  if (!auth) {
    return
  }

  const numericCredentialId = toSafeNumber(credentialId)
  if (!numericCredentialId) {
    sendError(req, res, 400, 'Invalid credential id.')
    return
  }

  try {
    const data = await deleteAssistantCredential({
      supabase,
      userKey: auth.userKey,
      credentialId: numericCredentialId,
    })
    sendJson(req, res, 200, data)
  } catch (error) {
    sendError(req, res, 500, error instanceof Error ? error.message : 'Failed to delete AI credential.')
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendError(req, res, 400, 'Invalid request.')
    return
  }

  setCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    const preflightOrigin = req.headers.origin
    if (preflightOrigin && getAllowedOrigin(preflightOrigin) === null) {
      res.writeHead(403)
      res.end()
      return
    }
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(req, res, 200, {
      ok: true,
      now: new Date().toISOString(),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/assistant/threads') {
    await handleAssistantThreadsList(req, res, url)
    return
  }

  if (req.method === 'POST' && url.pathname === '/assistant/threads') {
    await handleAssistantThreadCreate(req, res)
    return
  }

  if (req.method === 'GET' && url.pathname === '/assistant/credentials') {
    await handleAssistantCredentialsGet(req, res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/assistant/credentials') {
    await handleAssistantCredentialsSave(req, res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/admin/users') {
    await handleAdminUserCreate(req, res)
    return
  }

  const adminUserMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/)
  if (req.method === 'DELETE' && adminUserMatch) {
    await handleAdminUserDelete(req, res, adminUserMatch[1], url)
    return
  }

  const assistantCredentialMatch = url.pathname.match(/^\/assistant\/credentials\/(\d+)$/)
  if (req.method === 'DELETE' && assistantCredentialMatch) {
    await handleAssistantCredentialsDelete(req, res, assistantCredentialMatch[1])
    return
  }

  const assistantThreadMatch = url.pathname.match(/^\/assistant\/threads\/(\d+)$/)
  if (req.method === 'PATCH' && assistantThreadMatch) {
    await handleAssistantThreadUpdate(req, res, assistantThreadMatch[1])
    return
  }

  const assistantMessagesMatch = url.pathname.match(/^\/assistant\/threads\/(\d+)\/messages$/)
  if (req.method === 'GET' && assistantMessagesMatch) {
    await handleAssistantMessagesList(req, res, assistantMessagesMatch[1])
    return
  }

  const assistantStreamMatch = url.pathname.match(/^\/assistant\/threads\/(\d+)\/messages\/stream$/)
  if (req.method === 'POST' && assistantStreamMatch) {
    await handleAssistantMessageStream(req, res, assistantStreamMatch[1])
    return
  }

  if (req.method === 'POST' && url.pathname === '/runs') {
    // Read body once; dispatch to SQL or DSA path based on track/language
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendError(req, res, 400, error instanceof Error ? error.message : 'Invalid request body.')
      return
    }
    const trackKey = String(body?.track_key || '').trim()
    const language = String(body?.language || '').trim()
    if (trackKey === 'sql' || language === 'sql') {
      await createSqlRun(req, res, body)
    } else {
      await createDsaRun(req, res, body)
    }
    return
  }

  const runMatch = url.pathname.match(/^\/runs\/(\d+)$/)
  if (req.method === 'GET' && runMatch) {
    await getRun(req, res, runMatch[1], String(url.searchParams.get('user_key') || '').trim())
    return
  }

  sendError(req, res, 404, 'Not found.')
})

server.listen(runnerConfig.port, () => {
  process.stdout.write(`Runner service listening on http://localhost:${runnerConfig.port}\n`)
})
