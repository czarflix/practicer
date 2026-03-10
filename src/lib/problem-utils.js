export const COMPLETE_STATUSES = new Set(['solved', 'review'])
export const STATUS_VALUES = ['unsolved', 'attempted', 'solved', 'review']

export function toNumber(value) {
  const number = Number(value)
  return Number.isNaN(number) ? null : number
}

export function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function normalizeCompanies(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  return []
}

export function companiesToInput(value) {
  return normalizeCompanies(value).join(', ')
}

export function parseCompanyInput(input) {
  return normalizeCompanies(input)
}

export function normalizeDifficulty(value) {
  const text = normalizeText(value, 'Unknown').trim()
  return text.length > 0 ? text : 'Unknown'
}

export function difficultySortValue(value) {
  const normalized = normalizeDifficulty(value).toLowerCase()
  if (normalized === 'easy') {
    return 1
  }
  if (normalized === 'medium') {
    return 2
  }
  if (normalized === 'hard') {
    return 3
  }
  return 4
}

export function fallbackCompanionTier(pairTier) {
  const baseTier = toNumber(pairTier)
  if (!baseTier) {
    return null
  }

  return Math.min(3, baseTier + 1)
}

export function flattenProblems(problems) {
  if (
    (problems ?? []).some(
      (problem) =>
        Object.prototype.hasOwnProperty.call(problem ?? {}, 'problem_lc') ||
        Object.prototype.hasOwnProperty.call(problem ?? {}, 'problem_key'),
    )
  ) {
    return (problems ?? [])
      .map((problem) => ({
        rowId: problem.id,
        problemKey: normalizeText(problem.problem_key, ''),
        phase: toNumber(problem.phase),
        phaseOrder: toNumber(problem.phase_order),
        phaseName: normalizeText(problem.phase_name, ''),
        phaseDescription: normalizeText(problem.phase_description, ''),
        type: normalizeText(problem.source_type || problem.type || problem.track, ''),
        tier: toNumber(problem.tier),
        lc: toNumber(problem.problem_lc),
        title: normalizeText(problem.title, ''),
        difficulty: normalizeDifficulty(problem.difficulty),
        companies: normalizeCompanies(problem.companies),
        leetcodeUrl: normalizeText(problem.leetcode_url, ''),
        neetcodeUrl: normalizeText(problem.neetcode_url, ''),
        canonicalSourceUrl: normalizeText(problem.canonical_source_url, ''),
        sourceUrl: normalizeText(problem.source_url, ''),
        slug: normalizeText(problem.slug, ''),
        category: normalizeText(problem.category, ''),
        studyOrder: toNumber(problem.study_order),
        track: normalizeText(problem.track_key || problem.track, ''),
        sourcePlatform: normalizeText(problem.source_platform, ''),
        sourceProblemId: normalizeText(problem.source_problem_id, ''),
        companionProblemKey: normalizeText(problem.companion_problem_key, ''),
        companionLc: toNumber(problem.companion_lc),
        companionTitle: normalizeText(problem.companion_title, ''),
        companionRelationLabel: normalizeText(problem.companion_relation_label, ''),
        companionRelationNotes: normalizeText(problem.companion_relation_notes, ''),
      }))
      .filter((row) => (row.problemKey || row.lc !== null) && row.tier !== null)
  }

  const rows = []

  for (const problem of problems ?? []) {
    const base = {
      rowId: problem.id,
      phase: toNumber(problem.phase),
      phaseOrder: toNumber(problem.phase_order),
      phaseName: normalizeText(problem.phase_name, ''),
    }

    rows.push({
      ...base,
      problemKey: '',
      type: 'neetcode',
      tier: toNumber(problem.nc_tier) ?? toNumber(problem.tier),
      lc: toNumber(problem.nc_lc),
      title: normalizeText(problem.nc_title, ''),
      difficulty: normalizeDifficulty(problem.nc_difficulty),
      companies: normalizeCompanies(problem.nc_companies),
      leetcodeUrl: normalizeText(problem.nc_leetcode_url, ''),
      neetcodeUrl: normalizeText(problem.nc_neetcode_url, ''),
      canonicalSourceUrl: '',
      sourceUrl: '',
      slug: normalizeText(problem.nc_slug, ''),
      category: normalizeText(problem.nc_category, ''),
    })

    rows.push({
      ...base,
      problemKey: '',
      type: 'companion',
      tier: toNumber(problem.cp_tier) ?? fallbackCompanionTier(problem.tier),
      lc: toNumber(problem.cp_lc),
      title: normalizeText(problem.cp_title, ''),
      difficulty: normalizeDifficulty(problem.cp_difficulty),
      companies: normalizeCompanies(problem.cp_companies),
      leetcodeUrl: normalizeText(problem.cp_leetcode_url, ''),
      neetcodeUrl: '',
      canonicalSourceUrl: '',
      sourceUrl: '',
      slug: normalizeText(problem.cp_slug, ''),
      category: normalizeText(problem.cp_pattern_connection, ''),
    })
  }

  return rows.filter((row) => (row.problemKey || row.lc !== null) && row.tier !== null)
}

export function createProgressMap(progressRows) {
  return new Map(
    (progressRows ?? [])
      .map((row) => [problemIdentityKey(row.problem_key ?? row.problem_lc), row])
      .filter(([key]) => Boolean(key)),
  )
}

export function problemIdentityKey(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  const number = toNumber(value)
  return number !== null ? String(number) : ''
}

export function getProblemStatus(progressMap, problemOrKey) {
  const key =
    typeof problemOrKey === 'object' && problemOrKey !== null
      ? problemIdentityKey(problemOrKey.problemKey ?? problemOrKey.problem_key ?? problemOrKey.lc ?? problemOrKey.problem_lc)
      : problemIdentityKey(problemOrKey)

  return progressMap.get(key)?.status ?? 'unsolved'
}

export function isCompleteStatus(status) {
  return COMPLETE_STATUSES.has(status)
}

export function sortByStudyOrder(left, right) {
  return (
    (left.tier ?? 0) - (right.tier ?? 0) ||
    (left.phase ?? 0) - (right.phase ?? 0) ||
    (left.phaseOrder ?? 0) - (right.phaseOrder ?? 0) ||
    (left.studyOrder ?? 0) - (right.studyOrder ?? 0) ||
    (left.lc ?? 0) - (right.lc ?? 0) ||
    normalizeText(left.problemKey).localeCompare(normalizeText(right.problemKey))
  )
}

export function fuzzyIncludes(needle, haystack) {
  const query = normalizeText(needle).toLowerCase().trim()
  const target = normalizeText(haystack).toLowerCase()

  if (!query) {
    return true
  }

  if (target.includes(query)) {
    return true
  }

  let queryIndex = 0
  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] === query[queryIndex]) {
      queryIndex += 1
    }
  }

  return queryIndex === query.length
}

export function buildPhaseStats(flattenedProblems, progressMap) {
  const groupedByPhase = new Map()

  for (const row of flattenedProblems) {
    const phaseNumber = row.phase
    if (!phaseNumber) {
      continue
    }

    const list = groupedByPhase.get(phaseNumber) ?? []
    list.push(row)
    groupedByPhase.set(phaseNumber, list)
  }

  const phaseNumbers = Array.from(groupedByPhase.keys()).sort((left, right) => left - right)

  return phaseNumbers.map((phaseNumber) => {
    const problems = (groupedByPhase.get(phaseNumber) ?? []).sort(sortByStudyOrder)
    const total = problems.length
    const solved = problems.filter((problem) => isCompleteStatus(getProblemStatus(progressMap, problem))).length

    const tierStats = [1, 2, 3].map((tier) => {
      const tierRows = problems.filter((problem) => problem.tier === tier)
      const tierTotal = tierRows.length
      const tierSolved = tierRows.filter((problem) => isCompleteStatus(getProblemStatus(progressMap, problem))).length

      return { tier, total: tierTotal, solved: tierSolved }
    })

    return {
      order: phaseNumber,
      name: problems[0]?.phaseName || `Phase ${phaseNumber}`,
      total,
      solved,
      percent: total > 0 ? solved / total : 0,
      tierStats,
      problems,
    }
  })
}

export function formatDate(value, fallback = 'No deadline') {
  if (!value) {
    return fallback
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function clampPercent(value) {
  const safe = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(100, safe * 100))
}

export function sourcePlatformForProblem(problem) {
  const explicit = normalizeText(problem?.sourcePlatform ?? problem?.source_platform, '')
  const sourceUrl = sourceUrlForProblem(problem)

  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, '')

      if (host.includes('datalemur.com')) {
        return 'DataLemur'
      }
      if (host.includes('stratascratch.com')) {
        return 'StrataScratch'
      }
      if (host.includes('interviewquery.com')) {
        return 'InterviewQuery'
      }
      if (host.includes('hackerrank.com')) {
        return 'HackerRank'
      }
      if (host.includes('leetcode.com') || host.includes('leetcode.ca') || host.includes('leetcode.doocs.org')) {
        return 'LeetCode'
      }
      if (host.includes('medium.com')) {
        return 'Medium'
      }
    } catch {
      // fall through to explicit source fields
    }
  }

  if (explicit) {
    return explicit
  }

  if ((problem?.track || problem?.track_key) === 'sql') {
    return 'SQL'
  }

  return 'LeetCode'
}

export function sourceUrlForProblem(problem) {
  const direct = normalizeText(
    problem?.canonicalSourceUrl ??
      problem?.canonical_source_url ??
      problem?.sourceUrl ??
      problem?.source_url ??
      problem?.leetcodeUrl ??
      problem?.leetcode_url ??
      problem?.neetcodeUrl ??
      problem?.neetcode_url,
    '',
  )

  if (direct) {
    return direct
  }

  const explicitPlatform = normalizeText(problem?.sourcePlatform ?? problem?.source_platform, '')
  const isLeetCodeLike =
    explicitPlatform.toLowerCase() === 'leetcode' ||
    (!explicitPlatform && normalizeText(problem?.track ?? problem?.track_key, '') !== 'sql')

  if (isLeetCodeLike) {
    const slug = normalizeText(problem?.slug, '').trim()
    if (slug) {
      return `https://leetcode.com/problems/${slug}/`
    }
  }

  return ''
}

export function phaseLabel(problem) {
  const phase = toNumber(problem?.phase)
  const name = normalizeText(problem?.phaseName ?? problem?.phase_name, '')
  if (phase === null && !name) {
    return ''
  }
  if (phase === null) {
    return name
  }
  if (!name) {
    return String(phase)
  }
  return `${phase}. ${name}`
}

export function getYoutubeEmbedUrl(url) {
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace('www.', '')

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = parsed.searchParams.get('v')
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace('/', '')
      return id ? `https://www.youtube.com/embed/${id}` : null
    }

    return null
  } catch {
    return null
  }
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/**
 * Convert a title to a URL-safe slug.
 * "Two Sum" → "two-sum"
 */
export function slugify(title) {
  return normalizeText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Build a slug-based problem URL.
 * problemUrl(1, 'Two Sum') → '/problem/1-two-sum'
 */
export function problemUrl(problemOrKey, title) {
  if (problemOrKey && typeof problemOrKey === 'object') {
    const problemKey = normalizeText(problemOrKey.problemKey || problemOrKey.problem_key)
    const lc = toNumber(problemOrKey.lc ?? problemOrKey.problem_lc)
    const resolvedTitle = normalizeText(problemOrKey.title, title)
    if (problemKey) {
      return `/problem/${problemKey}`
    }
    if (lc) {
      const s = slugify(resolvedTitle)
      return `/problem/${lc}${s ? `-${s}` : ''}`
    }
    return '/problems'
  }

  if (typeof problemOrKey === 'string' && problemOrKey.trim()) {
    return `/problem/${problemOrKey.trim()}`
  }

  const lc = toNumber(problemOrKey)
  if (!lc) return '/problems'
  const s = slugify(title)
  return `/problem/${lc}${s ? `-${s}` : ''}`
}

/**
 * Extract the LC number from a slug like "1-two-sum" → 1
 */
export function lcFromSlug(slug) {
  if (!slug) return null
  const match = String(slug).match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

export function problemIdentifierFromSlug(slug) {
  const lc = lcFromSlug(slug)
  if (lc !== null) {
    return { type: 'lc', value: lc }
  }

  const value = normalizeText(slug).trim()
  return value ? { type: 'problem_key', value } : { type: 'unknown', value: '' }
}
