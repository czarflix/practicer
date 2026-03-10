const WEATHER_CACHE_KEY = 'dashboard-weather-cache-v1'
const WEATHER_DENIED_KEY = 'dashboard-weather-denied-until-v1'
const WEATHER_CACHE_TTL_MS = 1000 * 60 * 30
const WEATHER_DENIED_TTL_MS = 1000 * 60 * 60 * 6

function safeWindow() {
  return typeof window !== 'undefined' ? window : null
}

function safeStorage() {
  const win = safeWindow()
  try {
    return win?.localStorage ?? null
  } catch {
    return null
  }
}

function normalizeName(user) {
  return String(user?.label || user?.shortLabel || user?.short || 'there').trim() || 'there'
}

function greetingHeadline(hour, name) {
  if (hour < 5) {
    return `Good night, ${name}.`
  }

  if (hour < 12) {
    return `Good morning, ${name}.`
  }

  if (hour < 17) {
    return `Good afternoon, ${name}.`
  }

  if (hour < 22) {
    return `Good evening, ${name}.`
  }

  return `Good night, ${name}.`
}

function summarizeContext() {
  return ''
}

function weatherPrefix(weather) {
  if (!weather?.summary) {
    return ''
  }

  return `${weather.summary}.`
}

function weatherSummaryFromCode(code, isDay) {
  const numericCode = Number(code)
  if (!Number.isFinite(numericCode)) {
    return ''
  }

  if (numericCode === 0) {
    return isDay ? 'Clear skies' : 'Clear night'
  }

  if ([1, 2, 3].includes(numericCode)) {
    return isDay ? 'Cloud cover outside' : 'Cloudy tonight'
  }

  if ([45, 48].includes(numericCode)) {
    return 'Fog outside'
  }

  if (
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(
      numericCode,
    )
  ) {
    return 'Rain outside'
  }

  if ([71, 73, 75, 77, 85, 86].includes(numericCode)) {
    return 'Snow outside'
  }

  if ([95, 96, 99].includes(numericCode)) {
    return 'Storms nearby'
  }

  return ''
}

export function buildDashboardGreeting({
  user,
  hour,
  weather = null,
}) {
  const safeHour = Number.isFinite(hour) ? hour : new Date().getHours()
  const safeName = normalizeName(user)
  const contextLine = summarizeContext()
  const prefix = weatherPrefix(weather)
  const subline = prefix || contextLine || ''

  return {
    headline: greetingHeadline(safeHour, safeName),
    subline,
  }
}

export function readCachedWeather() {
  const storage = safeStorage()
  if (!storage) {
    return null
  }

  try {
    const raw = storage.getItem(WEATHER_CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const fetchedAt = Number(parsed.fetchedAt)
    if (!Number.isFinite(fetchedAt)) {
      return null
    }
    if (Date.now() - fetchedAt > WEATHER_CACHE_TTL_MS) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function cacheWeather(weather) {
  const storage = safeStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({
        ...weather,
        fetchedAt: Date.now(),
      }),
    )
  } catch {
    // Ignore cache write issues.
  }
}

export function shouldSkipWeatherRequest() {
  const storage = safeStorage()
  if (!storage) {
    return false
  }

  try {
    const deniedUntil = Number(storage.getItem(WEATHER_DENIED_KEY) || 0)
    return Number.isFinite(deniedUntil) && deniedUntil > Date.now()
  } catch {
    return false
  }
}

export function markWeatherDenied() {
  const storage = safeStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(WEATHER_DENIED_KEY, String(Date.now() + WEATHER_DENIED_TTL_MS))
  } catch {
    // Ignore cache write issues.
  }
}

export async function fetchWeatherSnapshot({ latitude, longitude, signal }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current', 'weather_code,is_day,temperature_2m')
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`)
  }

  const payload = await response.json()
  const current = payload?.current || {}
  const isDay = Number(current.is_day) === 1

  return {
    weatherCode: Number(current.weather_code),
    isDay,
    temperature: Number(current.temperature_2m),
    summary: weatherSummaryFromCode(current.weather_code, isDay),
  }
}
