import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '../context/user-store'
import { progressQueryOptions } from '../lib/supabase-queries'

export function useProgress(userKeyOverride = null) {
  const { userKey: currentUserKey } = useCurrentUser()
  const userKey = userKeyOverride ?? currentUserKey
  const query = useQuery({
    ...progressQueryOptions(userKey),
    enabled: Boolean(userKey),
  })

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  }
}
