import { useCallback, useEffect, useState } from 'react'

function normalizeError(error) {
  if (error instanceof Error) {
    return error
  }

  return new Error('Something went wrong while loading data.')
}

export function useData(fetcher, initialData = []) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const nextData = await fetcher()
      setData(nextData ?? initialData)
      return nextData
    } catch (caughtError) {
      const nextError = normalizeError(caughtError)
      setError(nextError)
      throw nextError
    } finally {
      setLoading(false)
    }
  }, [fetcher, initialData])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const nextData = await fetcher()
        if (mounted) {
          setData(nextData ?? initialData)
        }
      } catch (caughtError) {
        if (mounted) {
          setError(normalizeError(caughtError))
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      mounted = false
    }
  }, [fetcher, initialData])

  return { data, loading, error, refetch }
}
