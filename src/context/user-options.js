export const USER_OPTIONS = [
  { key: 'AYAAN', label: 'Ayaan', short: 'AA' },
  { key: 'MANTSHA', label: 'Mantsha', short: 'MS' },
]

export function normalizeUserKey(value) {
  const safe = String(value || '').toUpperCase().trim()
  if (safe === 'AYAN') {
    return 'AYAAN'
  }

  if (safe === 'MANTASHA') {
    return 'MANTSHA'
  }

  return USER_OPTIONS.some((option) => option.key === safe) ? safe : USER_OPTIONS[0].key
}
