import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const hasConfiguredCredentials = Boolean(supabaseUrl && supabaseAnonKey)
const hasValidSupabaseUrl = Boolean(supabaseUrl && isValidHttpUrl(supabaseUrl))

export const missingSupabaseMessage = !hasConfiguredCredentials
  ? 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.'
  : !hasValidSupabaseUrl
    ? 'Supabase is disabled because VITE_SUPABASE_URL is not a valid http(s) URL.'
    : 'Supabase is unavailable because the client could not be initialized.'

export const hasSupabaseCredentials = Boolean(hasConfiguredCredentials && hasValidSupabaseUrl)

let supabaseClient = null

if (hasSupabaseCredentials) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  } catch (error) {
    console.error('[supabase] Failed to initialize client:', error)
  }
}

export const supabase = supabaseClient
