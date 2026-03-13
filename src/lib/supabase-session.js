import { supabase } from './supabase'

export const SESSION_EXPIRED_MESSAGE = 'Session expired. Sign in again.'

const STALE_SESSION_PATTERNS = [
  /invalid refresh token/i,
  /refresh token not found/i,
  /refresh token.*expired/i,
  /jwt expired/i,
  /session.*expired/i,
]

function collectErrorText(error) {
  return [error?.message, error?.error_description, error?.details]
    .filter(Boolean)
    .map((value) => String(value))
    .join(' ')
    .trim()
}

export function isSupabaseSessionExpiredError(error) {
  const source = collectErrorText(error)
  return STALE_SESSION_PATTERNS.some((pattern) => pattern.test(source))
}

export async function clearLocalSupabaseSession(client = supabase) {
  if (!client?.auth?.signOut) {
    return
  }

  try {
    await client.auth.signOut({ scope: 'local' })
  } catch {
    // Best effort only. The caller still gets the normalized expired-session error.
  }
}

export async function normalizeSupabaseSessionError(error, client = supabase) {
  if (isSupabaseSessionExpiredError(error)) {
    await clearLocalSupabaseSession(client)
    const normalized = new Error(SESSION_EXPIRED_MESSAGE)
    normalized.name = 'SupabaseSessionError'
    normalized.code = 'SESSION_EXPIRED'
    normalized.cause = error
    return normalized
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(collectErrorText(error) || 'Session unavailable.')
}
