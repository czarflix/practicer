import { runnerConfig } from './config.mjs'

const PYTHON_LANGUAGE_ID = 71

function encodeBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64')
}

function decodeBase64(value) {
  if (!value) {
    return ''
  }

  try {
    return Buffer.from(String(value), 'base64').toString('utf8')
  } catch {
    return String(value)
  }
}

function mapJudge0StatusId(statusId) {
  if (statusId === 3) {
    return 'passed'
  }

  if (statusId === 4) {
    return 'failed'
  }

  if (statusId === 5) {
    return 'timeout'
  }

  return 'error'
}

export async function runOnJudge0(sourceCode) {
  const responseFields = [
    'token',
    'status',
    'time',
    'memory',
    'stdout',
    'stderr',
    'compile_output',
    'message',
    'exit_code',
    'exit_signal',
    'wall_time',
  ]

  const query = new URLSearchParams({
    base64_encoded: 'true',
    wait: 'true',
    fields: responseFields.join(','),
  })

  const headers = {
    'Content-Type': 'application/json',
  }

  if (runnerConfig.judge0ApiKey) {
    headers['X-Auth-Token'] = runnerConfig.judge0ApiKey
  }

  const response = await fetch(`${runnerConfig.judge0Url}/submissions?${query.toString()}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: PYTHON_LANGUAGE_ID,
      source_code: encodeBase64(sourceCode),
      stdin: encodeBase64(''),
      cpu_time_limit: runnerConfig.cpuTimeLimitSeconds,
      wall_time_limit: runnerConfig.wallTimeLimitSeconds,
      memory_limit: runnerConfig.memoryLimitKb,
      max_file_size: 1024,
      number_of_runs: 1,
      redirect_stderr_to_stdout: false,
      enable_per_process_and_thread_time_limit: true,
      enable_per_process_and_thread_memory_limit: true,
    }),
  })

  const rawText = await response.text()
  let payload = null

  try {
    payload = JSON.parse(rawText)
  } catch {
    payload = null
  }

  if (!response.ok || !payload) {
    throw new Error(`Judge0 request failed (${response.status}): ${rawText.slice(0, 400)}`)
  }

  const statusId = Number(payload?.status?.id)

  return {
    judgeToken: payload.token || null,
    judgeStatusId: Number.isFinite(statusId) ? statusId : null,
    judgeStatusDescription: String(payload?.status?.description || ''),
    mappedStatus: mapJudge0StatusId(statusId),
    stdout: decodeBase64(payload.stdout),
    stderr: decodeBase64(payload.stderr),
    compileOutput: decodeBase64(payload.compile_output),
    message: decodeBase64(payload.message),
    runtimeMs: Number.isFinite(Number(payload.time)) ? Math.round(Number(payload.time) * 1000) : null,
    memoryKb: Number.isFinite(Number(payload.memory)) ? Math.round(Number(payload.memory)) : null,
    raw: payload,
  }
}
