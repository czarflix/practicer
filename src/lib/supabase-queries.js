import { missingSupabaseMessage, supabase } from './supabase'

const INITIAL_PROBLEMS = []
const INITIAL_PROGRESS = []
const INITIAL_TARGETS = []

export const defaultQueryConfig = {
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 30,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
}

function ensureSupabase() {
  if (!supabase) {
    throw new Error(missingSupabaseMessage)
  }

  return supabase
}

export async function fetchProblems() {
  const client = ensureSupabase()

  const { data, error } = await client
    .from('v_study_problems')
    .select('*')
    .order('track_key', { ascending: true })
    .order('tier', { ascending: true })
    .order('phase', { ascending: true })
    .order('phase_order', { ascending: true })
    .order('study_order', { ascending: true })
    .order('problem_lc', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? INITIAL_PROBLEMS
}

export async function fetchProgress() {
  const client = ensureSupabase()
  const { data, error } = await client.from('progress').select('*')

  if (error) {
    throw error
  }

  return data ?? INITIAL_PROGRESS
}

export async function fetchTargets(activeOnly = false, trackKey = null) {
  const client = ensureSupabase()

  let query = client.from('targets').select('*').order('deadline', { ascending: true })

  if (activeOnly) {
    query = query.is('completed_at', null)
  }

  if (trackKey) {
    query = query.eq('track_key', trackKey)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? INITIAL_TARGETS
}

export async function fetchProgressByUser(userKey) {
  const client = ensureSupabase()
  const { data, error } = await client.from('progress').select('*').eq('user_key', userKey)

  if (error) {
    throw error
  }

  return data ?? INITIAL_PROGRESS
}

export async function fetchTargetsByUser(activeOnly = false, userKey, trackKey = null) {
  const client = ensureSupabase()

  let query = client.from('targets').select('*').eq('user_key', userKey).order('deadline', { ascending: true })

  if (activeOnly) {
    query = query.is('completed_at', null)
  }

  if (trackKey) {
    query = query.eq('track_key', trackKey)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data ?? INITIAL_TARGETS
}

export function problemsQueryOptions() {
  return {
    queryKey: ['problems'],
    queryFn: fetchProblems,
    ...defaultQueryConfig,
  }
}

export function progressQueryOptions(userKey = null) {
  if (userKey) {
    return {
      queryKey: ['progress', { userKey }],
      queryFn: () => fetchProgressByUser(userKey),
      staleTime: 0,
      gcTime: defaultQueryConfig.gcTime,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: defaultQueryConfig.retry,
      ...defaultQueryConfig,
    }
  }

  return {
    queryKey: ['progress'],
    queryFn: fetchProgress,
    staleTime: 0,
    gcTime: defaultQueryConfig.gcTime,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: defaultQueryConfig.retry,
    ...defaultQueryConfig,
  }
}

export function targetsQueryOptions(activeOnly = false, userKey = null, trackKey = null) {
  if (userKey) {
    return {
      queryKey: ['targets', { activeOnly, userKey, trackKey }],
      queryFn: () => fetchTargetsByUser(activeOnly, userKey, trackKey),
      ...defaultQueryConfig,
    }
  }

  return {
    queryKey: ['targets', { activeOnly, trackKey }],
    queryFn: () => fetchTargets(activeOnly, trackKey),
    ...defaultQueryConfig,
  }
}
