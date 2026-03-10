import { useQuery } from '@tanstack/react-query'
import { problemsQueryOptions } from '../lib/supabase-queries'

export function useProblems() {
  const query = useQuery(problemsQueryOptions())

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  }
}
