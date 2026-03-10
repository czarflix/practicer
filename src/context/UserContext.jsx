import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { USER_OPTIONS, normalizeUserKey } from './user-options'
import { UserStoreContext } from './user-store'
import { supabase, hasSupabaseCredentials } from '../lib/supabase'

const LOCAL_STORAGE_KEY = 'dsa-active-user'
const LOCAL_TRACK_STORAGE_KEY = 'dsa-active-track'

function normalizeTrackKey(value) {
  return value === 'sql' ? 'sql' : 'dsa'
}

function readStoredTrackKey() {
  if (typeof window === 'undefined') {
    return 'dsa'
  }

  return normalizeTrackKey(window.localStorage.getItem(LOCAL_TRACK_STORAGE_KEY))
}

function persistTrackKey(value) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_TRACK_STORAGE_KEY, normalizeTrackKey(value))
  }
}

// ─── Auth-aware provider (used when Supabase credentials are present) ─────────
function AuthUserProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = initial loading
  const [userKey, setUserKeyState] = useState(undefined)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTrackKey, setActiveTrackKeyState] = useState(readStoredTrackKey)
  const sessionUserIdRef = useRef(null)
  const userKeyRef = useRef(undefined)

  // Resolve app user_key from auth session
  const resolveUserKey = useCallback(async (currentSession) => {
    if (!currentSession?.user?.id) {
      setUserKeyState(null)
      return
    }

    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('user_key, is_admin')
        .eq('auth_user_id', currentSession.user.id)
        .maybeSingle()

      if (error) {
        console.error('[UserContext] resolveUserKey error:', error.message)
        setUserKeyState(null)
        setIsAdmin(false)
      } else if (data?.user_key) {
        setUserKeyState(data.user_key)
        setIsAdmin(Boolean(data.is_admin))
        try {
          const { data: settingsData, error: settingsError } = await supabase
            .from('user_settings')
            .select('active_track_key')
            .eq('user_key', data.user_key)
            .maybeSingle()

          if (settingsError) {
            console.error('[UserContext] resolveActiveTrackKey error:', settingsError.message)
            const fallbackTrack = readStoredTrackKey()
            setActiveTrackKeyState(fallbackTrack)
            persistTrackKey(fallbackTrack)
          } else {
            const nextTrack = normalizeTrackKey(settingsData?.active_track_key)
            setActiveTrackKeyState(nextTrack)
            persistTrackKey(nextTrack)
          }
        } catch (settingsErr) {
          console.error('[UserContext] resolveActiveTrackKey exception:', settingsErr)
          const fallbackTrack = readStoredTrackKey()
          setActiveTrackKeyState(fallbackTrack)
          persistTrackKey(fallbackTrack)
        }
      } else {
        // auth user exists but has no mapped app_users row yet
        setUserKeyState(null)
        setIsAdmin(false)
        setActiveTrackKeyState(readStoredTrackKey())
      }
    } catch (err) {
      console.error('[UserContext] resolveUserKey exception:', err)
      setUserKeyState(null)
      setIsAdmin(false)
      setActiveTrackKeyState(readStoredTrackKey())
    }
  }, [])

  useEffect(() => {
    userKeyRef.current = userKey
  }, [userKey])

  useEffect(() => {
    let isActive = true

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!isActive) {
        return
      }
      sessionUserIdRef.current = initialSession?.user?.id ?? null
      setSession(initialSession)
      void resolveUserKey(initialSession)
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return
      }

      const previousUserId = sessionUserIdRef.current
      const nextUserId = nextSession?.user?.id ?? null
      sessionUserIdRef.current = nextUserId
      setSession(nextSession)

      if (!nextUserId) {
        setUserKeyState(null)
        return
      }

      // Supabase emits SIGNED_IN on refocus/token refresh as well. Only remap when the user actually changes.
      if (previousUserId !== nextUserId || typeof userKeyRef.current === 'undefined') {
        setUserKeyState(undefined)
        void resolveUserKey(nextSession)
      }
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [resolveUserKey])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const setActiveTrackKey = useCallback(
    async (nextValue) => {
      const nextTrack = normalizeTrackKey(nextValue)
      setActiveTrackKeyState(nextTrack)
      persistTrackKey(nextTrack)

      const resolvedUserKey = userKeyRef.current
      if (!resolvedUserKey) {
        return
      }

      try {
        const { error } = await supabase.from('user_settings').upsert(
          {
            user_key: resolvedUserKey,
            active_track_key: nextTrack,
          },
          { onConflict: 'user_key' },
        )

        if (error) {
          throw error
        }
      } catch (err) {
        console.error('[UserContext] setActiveTrackKey error:', err)
      }
    },
    [],
  )

  const value = useMemo(() => {
    const resolvedUserKey = typeof userKey === 'string' ? userKey : ''
    const activeUser = USER_OPTIONS.find((o) => o.key === resolvedUserKey) ?? null
    const authLoading = typeof session === 'undefined' || (Boolean(session) && typeof userKey === 'undefined')
    return {
      userKey: resolvedUserKey,
      activeUser,
      // setUserKey kept as no-op in auth mode (use real auth)
      setUserKey: () => {},
      activeTrackKey,
      setActiveTrackKey,
      options: USER_OPTIONS,
      session: session ?? null,
      authLoading,
      isAdmin,
      signOut,
    }
  }, [activeTrackKey, isAdmin, session, setActiveTrackKey, signOut, userKey])

  return <UserStoreContext.Provider value={value}>{children}</UserStoreContext.Provider>
}

// ─── Local fallback provider (used when Supabase is not configured) ────────────
function LocalUserProvider({ children }) {
  const [userKey, setUserKey] = useState(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_STORAGE_KEY) : null
    return normalizeUserKey(stored)
  })
  const [activeTrackKey, setActiveTrackKey] = useState(readStoredTrackKey)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, userKey)
    }
  }, [userKey])

  useEffect(() => {
    persistTrackKey(activeTrackKey)
  }, [activeTrackKey])

  const value = useMemo(() => {
    const activeUser = USER_OPTIONS.find((option) => option.key === userKey) ?? USER_OPTIONS[0]
    return {
      userKey,
      activeUser,
      options: USER_OPTIONS,
      setUserKey: (next) => setUserKey(normalizeUserKey(next)),
      activeTrackKey,
      setActiveTrackKey: (next) => setActiveTrackKey(normalizeTrackKey(next)),
      session: null,
      authLoading: false,
      isAdmin: userKey === 'AYAAN',
      signOut: async () => {},
    }
  }, [activeTrackKey, userKey])

  return <UserStoreContext.Provider value={value}>{children}</UserStoreContext.Provider>
}

// ─── Public provider ──────────────────────────────────────────────────────────
export function UserProvider({ children }) {
  if (hasSupabaseCredentials) {
    return <AuthUserProvider>{children}</AuthUserProvider>
  }

  return <LocalUserProvider>{children}</LocalUserProvider>
}
