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

export function useSharedSolutions(problemRef, userKey) {
  const [sharedSolutions, setSharedSolutions] = useState([])
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

  const fetchSharedSolutions = useCallback(async () => {
    if (!supabase) return

    const query = applyProblemFilter(
      supabase.from('shared_solutions').select('*').order('created_at', { ascending: false }),
    )
    if (!query) return

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError
      setSharedSolutions(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shared solutions.')
    } finally {
      setLoading(false)
    }
  }, [applyProblemFilter])

  useEffect(() => {
    if (!supabase || (!resolved.problemKey && !resolved.problemLc)) return

    void fetchSharedSolutions()

    const channelName = resolved.problemKey || `lc-${resolved.problemLc}`
    const filter = resolved.problemKey
      ? `problem_key=eq.${resolved.problemKey}`
      : `problem_lc=eq.${resolved.problemLc}`

    const channel = supabase
      .channel(`shared_solutions:${channelName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_solutions', filter },
        ({ new: row }) => {
          setSharedSolutions((prev) => (prev.some((s) => s.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'shared_solutions', filter },
        ({ old: row }) => {
          setSharedSolutions((prev) => prev.filter((s) => s.id !== row.id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchSharedSolutions, resolved.problemKey, resolved.problemLc])

  const shareSolution = useCallback(
    async ({
      title,
      code,
      sourceSolutionId = null,
      sourceRunId = null,
      runtimeMs = null,
      testsPassed = null,
      testsTotal = null,
      language = 'python',
    }) => {
      if (!supabase || !userKey || !code?.trim()) return null
      if (!resolved.problemKey && !resolved.problemLc) return null

      const payload = {
        author_user_key: userKey,
        title: title?.trim() || `${userKey} solution`,
        code: code.trim(),
        language,
        source_solution_id: sourceSolutionId,
        source_run_id: sourceRunId,
        runtime_ms: runtimeMs,
        tests_passed: testsPassed,
        tests_total: testsTotal,
      }

      if (resolved.problemKey) {
        payload.problem_key = resolved.problemKey
      } else {
        payload.problem_lc = resolved.problemLc
      }

      const { data, error: insertError } = await supabase.from('shared_solutions').insert(payload).select('*').single()
      if (insertError) throw insertError
      setSharedSolutions((prev) => (prev.some((solution) => solution.id === data.id) ? prev : [data, ...prev]))
      return data
    },
    [resolved.problemKey, resolved.problemLc, userKey],
  )

  const deleteSharedSolution = useCallback(
    async (id) => {
      if (!supabase) return

      const { error: deleteError } = await supabase
        .from('shared_solutions')
        .delete()
        .eq('id', id)
        .eq('author_user_key', userKey)

      if (deleteError) throw deleteError
      setSharedSolutions((prev) => prev.filter((s) => s.id !== id))
    },
    [userKey],
  )

  return { sharedSolutions, loading, error, shareSolution, deleteSharedSolution, refetch: fetchSharedSolutions }
}
