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

/**
 * Fetches, posts, edits and deletes comments for a given problem identity.
 * Any authenticated user can read; only the author can mutate.
 */
export function useComments(problemRef, userKey) {
  const [comments, setComments] = useState([])
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

  const fetchComments = useCallback(async () => {
    if (!supabase) return

    const query = applyProblemFilter(supabase.from('problem_comments').select('*').order('created_at', { ascending: true }))
    if (!query) return

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError
      setComments(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comments.')
    } finally {
      setLoading(false)
    }
  }, [applyProblemFilter])

  useEffect(() => {
    if (!supabase || (!resolved.problemKey && !resolved.problemLc)) return

    void fetchComments()

    const channelName = resolved.problemKey || `lc-${resolved.problemLc}`
    const filter = resolved.problemKey
      ? `problem_key=eq.${resolved.problemKey}`
      : `problem_lc=eq.${resolved.problemLc}`

    const channel = supabase
      .channel(`comments:${channelName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'problem_comments', filter },
        ({ new: row }) => {
          setComments((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'problem_comments', filter },
        ({ new: row }) => {
          setComments((prev) => prev.map((c) => (c.id === row.id ? row : c)))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'problem_comments', filter },
        ({ old: row }) => {
          setComments((prev) => prev.filter((c) => c.id !== row.id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchComments, resolved.problemKey, resolved.problemLc])

  const addComment = useCallback(
    async (content, parentCommentId = null) => {
      if (!supabase || !userKey || !content.trim()) return
      if (!resolved.problemKey && !resolved.problemLc) return

      const payload = {
        author_user_key: userKey,
        content: content.trim(),
        parent_comment_id: parentCommentId,
      }

      if (resolved.problemKey) {
        payload.problem_key = resolved.problemKey
      } else {
        payload.problem_lc = resolved.problemLc
      }

      const { data, error: insertError } = await supabase.from('problem_comments').insert(payload).select('*').single()
      if (insertError) throw insertError
      setComments((prev) => (prev.some((comment) => comment.id === data.id) ? prev : [...prev, data]))
    },
    [resolved.problemKey, resolved.problemLc, userKey],
  )

  const updateComment = useCallback(
    async (id, content) => {
      if (!supabase || !content.trim()) return

      const { data, error: updateError } = await supabase
        .from('problem_comments')
        .update({ content: content.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('author_user_key', userKey)
        .select('*')
        .single()

      if (updateError) throw updateError
      setComments((prev) => prev.map((c) => (c.id === id ? data : c)))
    },
    [userKey],
  )

  const deleteComment = useCallback(
    async (id) => {
      if (!supabase) return

      const { error: deleteError } = await supabase
        .from('problem_comments')
        .delete()
        .eq('id', id)
        .eq('author_user_key', userKey)

      if (deleteError) throw deleteError
      setComments((prev) => prev.filter((c) => c.id !== id))
    },
    [userKey],
  )

  return { comments, loading, error, addComment, updateComment, deleteComment, refetch: fetchComments }
}
