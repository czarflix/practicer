import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeText, toNumber } from '../lib/problem-utils'

function resolveProblemRef(problemRef) {
  if (problemRef && typeof problemRef === 'object') {
    return {
      problemKey: normalizeText(problemRef.problemKey || problemRef.problem_key),
      problemLc: toNumber(problemRef.problemLc ?? problemRef.problem_lc ?? problemRef.lc),
    }
  }

  return {
    problemKey: '',
    problemLc: toNumber(problemRef),
  }
}

export function useSharedNotes(problemRef, userKey) {
  const [sharedNotes, setSharedNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const resolved = useMemo(() => resolveProblemRef(problemRef), [problemRef])

  const applyProblemFilter = useCallback(
    (query) => {
      if (resolved.problemKey) {
        return query.eq('problem_key', resolved.problemKey)
      }

      if (resolved.problemLc) {
        return query.eq('problem_lc', resolved.problemLc)
      }

      return null
    },
    [resolved.problemKey, resolved.problemLc],
  )

  const fetchSharedNotes = useCallback(async () => {
    if (!supabase) return

    const query = applyProblemFilter(
      supabase.from('shared_notes').select('*').order('created_at', { ascending: false }),
    )
    if (!query) return

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError
      setSharedNotes(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shared notes.')
    } finally {
      setLoading(false)
    }
  }, [applyProblemFilter])

  useEffect(() => {
    if (!supabase || (!resolved.problemKey && !resolved.problemLc)) return

    void fetchSharedNotes()

    const channelName = resolved.problemKey || `lc-${resolved.problemLc}`
    const filter = resolved.problemKey
      ? `problem_key=eq.${resolved.problemKey}`
      : `problem_lc=eq.${resolved.problemLc}`

    const channel = supabase
      .channel(`shared_notes:${channelName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_notes', filter },
        ({ new: row }) => {
          setSharedNotes((prev) => (prev.some((note) => note.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'shared_notes', filter },
        ({ new: row }) => {
          setSharedNotes((prev) => prev.map((note) => (note.id === row.id ? row : note)))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'shared_notes', filter },
        ({ old: row }) => {
          setSharedNotes((prev) => prev.filter((note) => note.id !== row.id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchSharedNotes, resolved.problemKey, resolved.problemLc])

  const shareNote = useCallback(
    async ({ title, content, sourceNoteId = null }) => {
      if (!supabase || !userKey || !content) return null
      if (!resolved.problemKey && !resolved.problemLc) return null

      const payload = {
        author_user_key: userKey,
        title: title?.trim() || `${userKey} note`,
        content,
        source_note_id: sourceNoteId,
      }

      if (resolved.problemKey) {
        payload.problem_key = resolved.problemKey
      } else {
        payload.problem_lc = resolved.problemLc
      }

      const { data, error: insertError } = await supabase.from('shared_notes').insert(payload).select('*').single()
      if (insertError) throw insertError

      setSharedNotes((prev) => (prev.some((note) => note.id === data.id) ? prev : [data, ...prev]))
      return data
    },
    [resolved.problemKey, resolved.problemLc, userKey],
  )

  const deleteSharedNote = useCallback(
    async (id) => {
      if (!supabase) return

      const { error: deleteError } = await supabase
        .from('shared_notes')
        .delete()
        .eq('id', id)
        .eq('author_user_key', userKey)

      if (deleteError) throw deleteError
      setSharedNotes((prev) => prev.filter((note) => note.id !== id))
    },
    [userKey],
  )

  return {
    sharedNotes,
    loading,
    error,
    shareNote,
    deleteSharedNote,
    refetch: fetchSharedNotes,
  }
}
