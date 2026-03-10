import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const ALL_TYPES = [
  'comment_added',
  'comment_replied',
  'shared_solution',
  'shared_note',
  'problem_solved',
  'daily_solved_milestone',
  'tier_completed',
  'problem_added',
  'test_case_added',
  'test_case_updated',
]

export function useNotificationPreferences(userKey) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchPreferences = useCallback(async () => {
    if (!supabase || !userKey) {
      setRows([])
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_key', userKey)

      if (error) {
        throw error
      }

      setRows(data ?? [])
    } catch (err) {
      console.error('[useNotificationPreferences] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [userKey])

  useEffect(() => {
    void fetchPreferences()
  }, [fetchPreferences])

  const preferences = useMemo(() => {
    const map = {}

    for (const type of ALL_TYPES) {
      map[type] = { send_enabled: true, receive_enabled: true }
    }

    for (const row of rows) {
      if (map[row.notification_type]) {
        map[row.notification_type] = {
          send_enabled: row.send_enabled ?? true,
          receive_enabled: row.receive_enabled ?? true,
        }
      }
    }

    return map
  }, [rows])

  const toggle = useCallback(
    async (notificationType, direction, enabled) => {
      if (!supabase || !userKey) {
        return
      }

      const column = direction === 'send' ? 'send_enabled' : 'receive_enabled'

      // Optimistic update
      setRows((current) => {
        const exists = current.some((r) => r.notification_type === notificationType)

        if (exists) {
          return current.map((r) =>
            r.notification_type === notificationType ? { ...r, [column]: enabled } : r,
          )
        }

        return [
          ...current,
          {
            user_key: userKey,
            notification_type: notificationType,
            send_enabled: direction === 'send' ? enabled : true,
            receive_enabled: direction === 'receive' ? enabled : true,
          },
        ]
      })

      try {
        const { error } = await supabase
          .from('notification_preferences')
          .upsert(
            {
              user_key: userKey,
              notification_type: notificationType,
              [column]: enabled,
            },
            { onConflict: 'user_key,notification_type' },
          )

        if (error) {
          throw error
        }
      } catch (err) {
        console.error('[useNotificationPreferences] toggle error:', err)
        void fetchPreferences()
      }
    },
    [userKey, fetchPreferences],
  )

  return {
    preferences,
    loading,
    toggle,
    refetch: fetchPreferences,
  }
}
