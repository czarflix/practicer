import { supabase } from './supabase'

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

async function getAccessToken() {
  if (!supabase) {
    throw new Error('Supabase is required for the AI assistant.')
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const accessToken = String(session?.access_token || '').trim()
  if (!accessToken) {
    throw new Error('Sign in to use the AI assistant.')
  }

  return accessToken
}

export function isAssistantConfigured() {
  return Boolean(assistantRunnerBaseUrl)
}

export async function assistantRequest(path, options = {}) {
  if (!assistantRunnerBaseUrl) {
    throw new Error('Runner service is not configured. Set VITE_RUNNER_API_URL.')
  }

  const accessToken = await getAccessToken()
  let response
  try {
    response = await fetch(`${assistantRunnerBaseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    throw new Error(normalizeAssistantNetworkError(error))
  }

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(payload?.error || `Assistant request failed (${response.status}).`)
  }

  return payload
}

export async function assistantStream(path, body, handlers) {
  if (!assistantRunnerBaseUrl) {
    throw new Error('Runner service is not configured. Set VITE_RUNNER_API_URL.')
  }

  const accessToken = await getAccessToken()
  let response
  try {
    response = await fetch(`${assistantRunnerBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(normalizeAssistantNetworkError(error))
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    throw new Error(payload?.error || `Assistant stream failed (${response.status}).`)
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''

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
        const event = JSON.parse(line)
        if (event.type === 'message') {
          handlers?.onMessage?.(event)
        } else if (event.type === 'status') {
          handlers?.onStatus?.(event)
        } else if (event.type === 'error') {
          handlers?.onError?.(event)
        } else if (event.type === 'done') {
          handlers?.onDone?.(event)
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }
}
