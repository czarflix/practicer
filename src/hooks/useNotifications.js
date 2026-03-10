import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useNotifications(userKey) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchNotifications = useCallback(async () => {
    if (!supabase || !userKey) {
      setNotifications([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_user_key', userKey)
        .order('created_at', { ascending: false })
        .limit(80)

      if (fetchError) {
        throw fetchError
      }

      setNotifications(data ?? [])
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to load notifications.')
    } finally {
      setLoading(false)
    }
  }, [userKey])

  useEffect(() => {
    if (!supabase || !userKey) {
      return undefined
    }

    void fetchNotifications()

    const channel = supabase
      .channel(`notifications:${userKey}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_key=eq.${userKey}` },
        ({ new: row }) => {
          setNotifications((current) => (current.some((item) => item.id === row.id) ? current : [row, ...current]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_user_key=eq.${userKey}` },
        ({ new: row }) => {
          setNotifications((current) => current.map((item) => (item.id === row.id ? row : item)))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications', filter: `recipient_user_key=eq.${userKey}` },
        ({ old: row }) => {
          setNotifications((current) => current.filter((item) => item.id !== row.id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchNotifications, userKey])

  const markRead = useCallback(
    async (id) => {
      if (!supabase || !userKey || !id) {
        return
      }

      const readAt = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ read_at: readAt })
        .eq('id', id)
        .eq('recipient_user_key', userKey)
        .is('read_at', null)

      if (updateError) {
        throw updateError
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                read_at: item.read_at ?? readAt,
              }
            : item,
        ),
      )
    },
    [userKey],
  )

  const markAllRead = useCallback(async () => {
    if (!supabase || !userKey) {
      return
    }

    const readAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('recipient_user_key', userKey)
      .is('read_at', null)

    if (updateError) {
      throw updateError
    }

    setNotifications((current) =>
      current.map((item) => ({
        ...item,
        read_at: item.read_at ?? readAt,
      })),
    )
  }, [userKey])

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => count + (item.read_at ? 0 : 1), 0),
    [notifications],
  )

  return {
    notifications,
    loading,
    error,
    unreadCount,
    hasUnread: unreadCount > 0,
    markRead,
    markAllRead,
    refetch: fetchNotifications,
  }
}
