import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULTS = {
  active_track_key: 'dsa',
  solve_broadcast_mode: 'every_solve',
  milestone_threshold: 5,
  dashboard_comparison_mode: 'compare',
  preferred_ai_provider_mode: 'platform',
}

export function useUserSettings(userKey) {
  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)

  const fetchSettings = useCallback(async () => {
    if (!supabase || !userKey) {
      setSettings(DEFAULTS)
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_key', userKey)
        .maybeSingle()

      if (error) {
        throw error
      }

      setSettings({
        active_track_key: data?.active_track_key ?? DEFAULTS.active_track_key,
        solve_broadcast_mode: data?.solve_broadcast_mode ?? DEFAULTS.solve_broadcast_mode,
        milestone_threshold: data?.milestone_threshold ?? DEFAULTS.milestone_threshold,
        dashboard_comparison_mode: data?.dashboard_comparison_mode ?? DEFAULTS.dashboard_comparison_mode,
        preferred_ai_provider_mode: data?.preferred_ai_provider_mode ?? DEFAULTS.preferred_ai_provider_mode,
      })
    } catch (err) {
      console.error('[useUserSettings] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [userKey])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const update = useCallback(
    async (patch) => {
      if (!supabase || !userKey) {
        return
      }

      // Optimistic update
      setSettings((current) => ({ ...current, ...patch }))

      try {
        const { error } = await supabase.from('user_settings').upsert(
          {
            user_key: userKey,
            ...patch,
          },
          { onConflict: 'user_key' },
        )

        if (error) {
          throw error
        }
      } catch (err) {
        console.error('[useUserSettings] update error:', err)
        void fetchSettings()
      }
    },
    [userKey, fetchSettings],
  )

  return {
    settings,
    loading,
    update,
    refetch: fetchSettings,
  }
}
