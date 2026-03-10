import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '../context/user-store'
import { buildProblemPresentation, normalizeProblemDescription } from '../lib/problem-content'
import { missingSupabaseMessage, supabase } from '../lib/supabase'
import {
  normalizeCompanies,
  normalizeDifficulty,
  normalizeText,
  problemIdentityKey,
  problemIdentifierFromSlug,
  toNumber,
} from '../lib/problem-utils'

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  return []
}

function resolveIdentifier(input) {
  if (input && typeof input === 'object' && input.type && Object.prototype.hasOwnProperty.call(input, 'value')) {
    return input
  }

  if (typeof input === 'string') {
    return problemIdentifierFromSlug(input)
  }

  const lc = toNumber(input)
  if (lc !== null) {
    return { type: 'lc', value: lc }
  }

  return { type: 'unknown', value: '' }
}

async function fetchProblemRow(identifier) {
  const query = supabase.from('v_study_problems').select('*')

  if (identifier.type === 'problem_key') {
    const { data, error } = await query.eq('problem_key', identifier.value).maybeSingle()
    if (!error || error.code !== '42703') {
      if (error) {
        throw error
      }
      return data
    }
  }

  if (identifier.type === 'lc') {
    const { data, error } = await supabase
      .from('v_study_problems')
      .select('*')
      .eq('problem_lc', identifier.value)
      .maybeSingle()

    if (error) {
      throw error
    }

    return data
  }

  return null
}

async function fetchProblemBundle(identifierInput, userKey) {
  if (!supabase) {
    throw new Error(missingSupabaseMessage)
  }

  const identifier = resolveIdentifier(identifierInput)
  if (identifier.type === 'unknown' || !identifier.value) {
    throw new Error('Invalid problem id.')
  }

  const problemRow = await fetchProblemRow(identifier)
  if (!problemRow) {
    throw new Error(`No problem found for ${identifier.value}.`)
  }

  const problemKey = normalizeText(problemRow.problem_key, '')
  const problemLc = toNumber(problemRow.problem_lc)
  const trackKey = normalizeText(problemRow.track_key || problemRow.track, 'dsa') || 'dsa'
  const useProblemKey = Boolean(problemKey)

  const filterByProblem = (queryBuilder) => {
    if (useProblemKey) {
      return queryBuilder.eq('problem_key', problemKey)
    }

    if (problemLc !== null) {
      return queryBuilder.eq('problem_lc', problemLc)
    }

    throw new Error(`Problem ${identifier.value} has no usable identity.`)
  }

  const [
    progressResult,
    notesResult,
    solutionsResult,
    resourcesResult,
    contentResult,
    runsResult,
    overrideResult,
    testsResult,
    sqlSpecResult,
    sqlFixturesResult,
  ] = await Promise.all([
    filterByProblem(
      supabase.from('progress').select('*').eq('user_key', userKey),
    ).maybeSingle(),
    filterByProblem(
      supabase.from('notes').select('*').eq('user_key', userKey).order('sort_order', { ascending: true }),
    ),
    filterByProblem(
      supabase.from('solutions').select('*').eq('user_key', userKey).order('sort_order', { ascending: true }),
    ),
    filterByProblem(
      supabase.from('resources').select('*').eq('user_key', userKey).order('added_at', { ascending: false }),
    ),
    filterByProblem(supabase.from('problem_content').select('*')).maybeSingle(),
    filterByProblem(
      supabase.from('code_runs').select('*').eq('user_key', userKey).order('created_at', { ascending: false }).limit(30),
    ),
    filterByProblem(
      supabase.from('user_problem_overrides').select('*').eq('user_key', userKey),
    ).maybeSingle(),
    trackKey === 'dsa'
      ? filterByProblem(
          supabase
            .from('problem_test_cases')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
        )
      : Promise.resolve({ data: [], error: null }),
    trackKey === 'sql'
      ? supabase.from('sql_problem_specs').select('*').eq('problem_key', problemKey).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    trackKey === 'sql'
      ? supabase
          .from('sql_problem_fixtures')
          .select('*')
          .eq('problem_key', problemKey)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  for (const result of [
    progressResult,
    notesResult,
    solutionsResult,
    resourcesResult,
    contentResult,
    runsResult,
    overrideResult,
    testsResult,
    sqlSpecResult,
    sqlFixturesResult,
  ]) {
    if (result?.error) {
      throw result.error
    }
  }

  const resolvedSourceType = normalizeText(
    problemRow.source_type || problemRow.type || problemRow.track_key || problemRow.track,
    trackKey === 'sql' ? 'sql' : 'neetcode',
  )
  const isNeetcode = resolvedSourceType === 'neetcode'

  const active = {
    type: resolvedSourceType,
    track: trackKey,
    problemKey,
    title: problemRow.title,
    lc: problemLc,
    tier: problemRow.tier,
    difficulty: problemRow.difficulty,
    companies: problemRow.companies,
    leetcodeUrl: problemRow.leetcode_url,
    neetcodeUrl: problemRow.neetcode_url,
    slug: problemRow.slug,
    category: problemRow.category,
    sourcePlatform: problemRow.source_platform,
    sourceProblemId: problemRow.source_problem_id,
  }

  const companion = {
    type: problemRow.companion_source_type,
    problemKey: problemRow.companion_problem_key,
    title: problemRow.companion_title,
    lc: problemRow.companion_lc,
    tier: problemRow.companion_tier,
    difficulty: problemRow.companion_difficulty,
    companies: problemRow.companion_companies,
    leetcodeUrl: problemRow.companion_leetcode_url,
    neetcodeUrl: problemRow.companion_neetcode_url,
    slug: problemRow.companion_slug,
    patternConnection: problemRow.companion_relation_label,
    why: problemRow.companion_relation_notes,
  }

  return {
    problemKey,
    lc: problemLc,
    trackKey,
    userKey,
    row: problemRow,
    active,
    companion,
    isNeetcode,
    progress: progressResult.data ?? null,
    notes: notesResult.data ?? [],
    solutions: solutionsResult.data ?? [],
    resources: resourcesResult.data ?? [],
    content: contentResult.data ?? null,
    tests: testsResult.data ?? [],
    runs: runsResult.data ?? [],
    override: overrideResult.data ?? null,
    sqlSpec: sqlSpecResult.data ?? null,
    sqlFixtures: sqlFixturesResult.data ?? [],
  }
}

function normalizeProgress(progress, userKey, problemKey) {
  if (!progress) {
    return {
      user_key: userKey,
      problem_key: problemKey || null,
      status: 'unsolved',
      difficulty_rating: null,
      time_spent: 0,
      is_bookmarked: false,
      solved_at: null,
      last_reviewed: null,
    }
  }

  const rating = toNumber(progress.difficulty_rating)
  const safeRating = rating && rating >= 1 && rating <= 5 ? rating : null

  return {
    ...progress,
    user_key: progress.user_key ?? userKey,
    problem_key: normalizeText(progress.problem_key, problemKey),
    difficulty_rating: safeRating,
    time_spent: toNumber(progress.time_spent) ?? 0,
    status: progress.status ?? 'unsolved',
  }
}

function applyOverride(active, override) {
  if (!override) {
    return active
  }

  const customCompanies = normalizeCompanies(override.custom_companies)
  const customTitle = normalizeText(override.custom_title).trim()
  const customDifficulty = normalizeText(override.custom_difficulty).trim()
  const customLeetCodeUrl = normalizeText(override.custom_leetcode_url).trim()
  const customNeetcodeUrl = normalizeText(override.custom_neetcode_url).trim()

  return {
    ...active,
    title: customTitle || active.title,
    difficulty: customDifficulty || active.difficulty,
    companies: customCompanies.length > 0 ? customCompanies : active.companies,
    leetcodeUrl: customLeetCodeUrl || active.leetcodeUrl,
    neetcodeUrl: customNeetcodeUrl || active.neetcodeUrl,
  }
}

function normalizeContent(content, fallbackTitle, fallbackDifficulty) {
  if (!content) {
    return {
      title: fallbackTitle,
      difficulty: fallbackDifficulty,
      tags: [],
      description: '',
      presentation: buildProblemPresentation({ description: '', examples: [] }),
      starterCode: '',
      starterSnippet: '',
      entryPoint: '',
      source: 'manual',
      datasetSplit: null,
      examples: [],
      editorLanguage: 'python',
      runtimeKind: 'python_problem',
    }
  }

  const description = normalizeProblemDescription(normalizeText(content.problem_description || content.statement_clean))
  const structuredPresentation =
    content.presentation &&
    typeof content.presentation === 'object' &&
    !Array.isArray(content.presentation) &&
    Object.keys(content.presentation).length > 0
      ? content.presentation
      : null
  const examples = normalizeArray(
    structuredPresentation?.examples?.length ? structuredPresentation.examples : content.input_output || content.examples,
  )

  return {
    ...content,
    title: normalizeText(content.title, fallbackTitle) || fallbackTitle,
    difficulty: normalizeDifficulty(content.difficulty || fallbackDifficulty),
    tags: normalizeArray(content.tags).filter((tag) => typeof tag === 'string' && tag.trim().length > 0),
    description,
    presentation: structuredPresentation ?? buildProblemPresentation({ description, examples }),
    starterCode: normalizeText(content.starter_code || content.starter_snippet),
    starterSnippet: normalizeText(content.starter_snippet || content.starter_code),
    entryPoint: normalizeText(content.entry_point),
    source: normalizeText(content.source, 'manual'),
    datasetSplit: content.dataset_split ?? null,
    examples,
    editorLanguage: normalizeText(content.editor_language, 'python'),
    runtimeKind: normalizeText(content.runtime_kind, 'python_problem'),
  }
}

function normalizeSqlFixtures(fixtures) {
  return (fixtures ?? []).map((fixture) => ({
    ...fixture,
    expected_columns: normalizeArray(fixture.expected_columns),
    expected_rows: normalizeArray(fixture.expected_rows),
    setup_sql: normalizeText(fixture.setup_sql),
    postcheck_sql: normalizeText(fixture.postcheck_sql),
    label: normalizeText(fixture.label, fixture.fixture_key),
  }))
}

export function useProblemBundle(problemIdentifier) {
  const { userKey } = useCurrentUser()
  const resolved = resolveIdentifier(problemIdentifier)
  const identityKey = problemIdentityKey(resolved.value)
  const enabled = Boolean(identityKey) && resolved.type !== 'unknown'

  const query = useQuery({
    queryKey: ['problem-bundle', resolved.type, identityKey, userKey],
    queryFn: () => fetchProblemBundle(resolved, userKey),
    enabled,
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const bundle = useMemo(() => {
    if (!query.data) {
      return null
    }

    const { active, companion, progress, content, tests, override, sqlSpec, sqlFixtures, problemKey, trackKey } =
      query.data

    const normalizedActive = {
      ...active,
      difficulty: normalizeDifficulty(active.difficulty),
      companies: normalizeCompanies(active.companies),
      tier: toNumber(active.tier),
      lc: toNumber(active.lc),
      problemKey,
      track: trackKey,
    }

    const withOverride = applyOverride(normalizedActive, override)
    const normalizedContent = normalizeContent(content, withOverride.title, withOverride.difficulty)
    const normalizedTests = (tests ?? []).map((test) => ({
      ...test,
      input_text: normalizeText(test.input_text),
      expected_output: normalizeText(test.expected_output),
    }))
    const normalizedSqlFixtures = normalizeSqlFixtures(sqlFixtures)
    const hasRunnableDataset =
      trackKey === 'sql'
        ? normalizedSqlFixtures.length > 0
        : normalizedContent.starterCode.trim().length > 0 &&
          normalizedContent.entryPoint.trim().length > 0 &&
          normalizedTests.length > 0

    return {
      ...query.data,
      active: withOverride,
      companion: {
        ...companion,
        difficulty: normalizeDifficulty(companion.difficulty),
        companies: normalizeCompanies(companion.companies),
        tier: toNumber(companion.tier),
        lc: toNumber(companion.lc),
        problemKey: normalizeText(companion.problemKey),
      },
      progress: normalizeProgress(progress, userKey, problemKey),
      content: normalizedContent,
      tests: normalizedTests,
      sqlSpec,
      sqlFixtures: normalizedSqlFixtures,
      hasRunnableDataset,
    }
  }, [query.data, userKey])

  return {
    data: bundle,
    loading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
    isFetching: query.isFetching,
  }
}
