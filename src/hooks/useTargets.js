import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '../context/user-store'
import { targetsQueryOptions } from '../lib/supabase-queries'

export function useTargets({ activeOnly = false } = {}) {
  const { userKey, activeTrackKey } = useCurrentUser()
  const query = useQuery(targetsQueryOptions(activeOnly, userKey, activeTrackKey))

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  }
}
