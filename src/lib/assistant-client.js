import { supabase } from './supabase'
import { normalizeSupabaseSessionError } from './supabase-session'

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

export const assistantRunnerBaseUrl = trimBaseUrl(import.meta.env.VITE_RUNNER_API_URL || '')

function normalizeAssistantNetworkError(error) {
  const message = String(error?.message || '').trim()
  if (!message) {
    return 'Assistant is unavailable right now.'
  }

  if (
    /networkerror/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /load failed/i.test(message)
  ) {
    return 'Assistant is unavailable right now.'
  }

  return message
}

function parseJsonSafely(text) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function createRunnerRequestError(message, extra = {}) {
  const error = new Error(message)
  error.name = 'RunnerRequestError'
  Object.assign(error, extra)
  return error
}

async function getAccessToken() {
  if (!supabase) {
    throw new Error('Supabase is required for the AI assistant.')
  }

  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch (error) {
    throw await normalizeSupabaseSessionError(error, supabase)
  }

  if (sessionResult?.error) {
    throw await normalizeSupabaseSessionError(sessionResult.error, supabase)
  }

  const session = sessionResult?.data?.session ?? null

  const accessToken = String(session?.access_token || '').trim()
  if (!accessToken) {
    throw new Error('Sign in to use the AI assistant.')
  }

  return accessToken
}

export function isRunnerConfigured() {
  return Boolean(assistantRunnerBaseUrl)
}

export function isAssistantConfigured() {
  return isRunnerConfigured()
}

export async function runnerRequest(path, options = {}) {
  if (!assistantRunnerBaseUrl) {
    throw createRunnerRequestError('Runner service is not configured. Set VITE_RUNNER_API_URL.', {
      path,
      status: null,
    })
  }

  const accessToken = await getAccessToken()
  let response
  try {
    response = await fetch(`${assistantRunnerBaseUrl}${path}`, {
      ...options,
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    throw createRunnerRequestError(normalizeAssistantNetworkError(error), {
      path,
      status: null,
      cause: error,
    })
  }

  const text = await response.text()
  const payload = parseJsonSafely(text)

  if (!response.ok) {
    throw createRunnerRequestError(payload?.error || text || `Runner request failed (${response.status}).`, {
      path,
      status: response.status,
      payload,
    })
  }

  return payload
}

export async function assistantRequest(path, options = {}) {
  return runnerRequest(path, options)
}

export async function assistantStream(path, body, handlers, options = {}) {
  if (!assistantRunnerBaseUrl) {
    throw createRunnerRequestError('Runner service is not configured. Set VITE_RUNNER_API_URL.', {
      path,
      status: null,
    })
  }

  const accessToken = await getAccessToken()
  let response
  try {
    response = await fetch(`${assistantRunnerBaseUrl}${path}`, {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw createRunnerRequestError(normalizeAssistantNetworkError(error), {
      path,
      status: null,
      cause: error,
    })
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    const payload = parseJsonSafely(text)
    throw createRunnerRequestError(payload?.error || text || `Assistant stream failed (${response.status}).`, {
      path,
      status: response.status,
      payload,
    })
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  let streamError = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        const event = parseJsonSafely(line)
        if (!event) {
          newlineIndex = buffer.indexOf('\n')
          continue
        }
        if (event.type === 'message') {
          handlers?.onMessage?.(event)
        } else if (event.type === 'status') {
          handlers?.onStatus?.(event)
        } else if (event.type === 'error') {
          handlers?.onError?.(event)
          streamError = event
          await reader.cancel().catch(() => {})
          break
        } else if (event.type === 'done') {
          handlers?.onDone?.(event)
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }

    if (streamError) {
      break
    }
  }

  if (streamError) {
    throw createRunnerRequestError(streamError.error || 'Assistant stream failed.', {
      path,
      status: null,
      payload: streamError,
    })
  }
}
