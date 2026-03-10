import { useEffect, useMemo, useState } from 'react'
import {
  buildDashboardGreeting,
  cacheWeather,
  fetchWeatherSnapshot,
  markWeatherDenied,
  readCachedWeather,
  shouldSkipWeatherRequest,
} from '../lib/dashboard-greeting'

export function useDashboardGreeting({ user }) {
  const [weather, setWeather] = useState(() => readCachedWeather())

  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null
    if (!win || !win.navigator?.geolocation) {
      return undefined
    }

    if (readCachedWeather()) {
      return undefined
    }

    if (shouldSkipWeatherRequest()) {
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()

    const requestWeather = () => {
      win.navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const snapshot = await fetchWeatherSnapshot({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              signal: controller.signal,
            })
            if (!cancelled) {
              cacheWeather(snapshot)
              setWeather(snapshot)
            }
          } catch {
            // Keep local fallback greeting.
          }
        },
        () => {
          markWeatherDenied()
        },
        {
          enableHighAccuracy: false,
          maximumAge: 1000 * 60 * 30,
          timeout: 5000,
        },
      )
    }

    const permissions = win.navigator.permissions
    if (permissions?.query) {
      permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          if (cancelled) {
            return
          }
          if (result.state === 'denied') {
            markWeatherDenied()
            return
          }
          requestWeather()
        })
        .catch(() => {
          requestWeather()
        })
    } else {
      requestWeather()
    }

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return useMemo(
    () =>
      buildDashboardGreeting({
        user,
        hour: new Date().getHours(),
        weather,
      }),
    [user, weather],
  )
}
