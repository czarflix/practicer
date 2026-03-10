import { normalizeText } from './problem-utils'

export const TRACK_OPTIONS = [
  { value: 'dsa', label: 'DSA' },
  { value: 'sql', label: 'SQL' },
]

export const SQL_PHASE_CHOICES = [
  { phase: 1, name: 'Joins & Grain Control' },
  { phase: 2, name: 'Window Functions: Ranking & Row-wise Selection' },
  { phase: 3, name: 'Time Series Metrics: Rolling, MoM, YoY' },
  { phase: 4, name: 'Gaps & Islands: Streaks and Contiguous Intervals' },
  { phase: 5, name: 'Sessionization & Interval Reasoning' },
  { phase: 6, name: 'Funnels, Retention, Cohorts, and Churn Metrics' },
  { phase: 7, name: 'Schema Pivoting & Reshaping Output' },
  { phase: 8, name: 'Advanced CTEs: Recursion, Expansion, and Hierarchies' },
]

export const SQL_SUBMISSION_KIND_OPTIONS = [
  { value: 'query', label: 'Query' },
  { value: 'script', label: 'Script' },
]

export const SQL_RESULT_MODE_OPTIONS = [
  { value: 'direct_result', label: 'Direct Result' },
  { value: 'postcheck_query', label: 'Postcheck Query' },
]

export const SQL_COMPARISON_MODE_OPTIONS = [
  { value: 'unordered_multiset', label: 'Unordered Rows' },
  { value: 'ordered_rows', label: 'Ordered Rows' },
  { value: 'single_row', label: 'Single Row' },
  { value: 'single_value', label: 'Single Value' },
]

export function defaultPhaseChoicesForTrack(trackKey, existingChoices = []) {
  if (trackKey === 'sql') {
    return SQL_PHASE_CHOICES
  }

  if (Array.isArray(existingChoices) && existingChoices.length > 0) {
    return existingChoices
  }

  return [{ phase: 1, name: 'Frequency & Hashing' }]
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildProblemKey({
  trackKey,
  problemLc,
  sourcePlatform,
  sourceProblemId,
  slug,
  title,
}) {
  if (trackKey === 'dsa') {
    return problemLc ? `dsa-leetcode-${problemLc}` : ''
  }

  const normalizedPlatform = slugify(sourcePlatform || trackKey || 'sql')
  const stableTail = slugify(sourceProblemId || slug || title)
  return stableTail ? `${trackKey}-${normalizedPlatform}-${stableTail}` : ''
}

export function sourceLabelForProblem(problem) {
  if (problem?.track === 'sql' || problem?.track_key === 'sql') {
    const platform = normalizeText(problem.sourcePlatform || problem.source_platform)
    const sourceId = normalizeText(problem.sourceProblemId || problem.source_problem_id)
    return [platform, sourceId].filter(Boolean).join(' · ') || 'SQL'
  }

  return problem?.lc ? `LC#${problem.lc}` : 'DSA'
}
