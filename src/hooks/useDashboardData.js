import { useMemo } from 'react'
import {
  buildPhaseStats,
  createProgressMap,
  flattenProblems,
  getProblemStatus,
  isCompleteStatus,
  problemIdentityKey,
  sortByStudyOrder,
  toNumber,
} from '../lib/problem-utils'
import { useProblems } from './useProblems'
import { useProgress } from './useProgress'
import { useTargets } from './useTargets'
import { useCurrentUser } from '../context/user-store'

const TIER_IDS = [1, 2, 3]

function parseDate(value) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function toDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function diffInDays(start, end) {
  const startDay = startOfDay(start)
  const endDay = startOfDay(end)
  return Math.floor((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24))
}

function parseTargetValue(value) {
  if (!value) {
    return {}
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'object' && parsed ? parsed : {}
    } catch {
      return {}
    }
  }

  return typeof value === 'object' ? value : {}
}

function getDeadlineMeta(deadline, today) {
  const parsed = parseDate(deadline)
  if (!parsed) {
    return { daysLeft: null, overdueDays: 0, hasDeadline: false, deadlineDate: null, deadlineSort: Number.MAX_SAFE_INTEGER }
  }

  const delta = diffInDays(today, parsed)

  return {
    daysLeft: Math.max(delta, 0),
    overdueDays: delta < 0 ? Math.abs(delta) : 0,
    hasDeadline: true,
    deadlineDate: parsed,
    deadlineSort: parsed.getTime(),
  }
}

function buildSolvedSeries(progressRows, days = 30) {
  const today = startOfDay(new Date())

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = addDays(today, -(days - 1 - index))
    return {
      date,
      key: toDayKey(date),
      count: 0,
    }
  })

  const byDay = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  for (const row of progressRows) {
    const solvedAt = parseDate(row.solved_at)
    if (!solvedAt) {
      continue
    }

    const key = toDayKey(startOfDay(solvedAt))
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.count += 1
    }
  }

  return buckets
}

function getAverage(series, days) {
  const tail = series.slice(-days)
  const solved = tail.reduce((sum, day) => sum + day.count, 0)
  return solved / days
}

function priorityFromStatus(status) {
  if (status === 'review') {
    return 1
  }

  if (status === 'attempted') {
    return 2
  }

  return 3
}

function getTierTargetByTier(targets, today) {
  const byTier = new Map()

  for (const target of targets) {
    if (target.target_type !== 'tier' || target.completed_at) {
      continue
    }

    const value = parseTargetValue(target.target_value)
    const tier = toNumber(value.tier)
    if (!tier || !TIER_IDS.includes(tier)) {
      continue
    }

    const candidate = byTier.get(tier)
    if (!candidate) {
      byTier.set(tier, target)
      continue
    }

    const candidateDeadline = getDeadlineMeta(candidate.deadline, today).deadlineSort
    const nextDeadline = getDeadlineMeta(target.deadline, today).deadlineSort

    if (nextDeadline < candidateDeadline) {
      byTier.set(tier, target)
      continue
    }

    if (nextDeadline === candidateDeadline) {
      const candidateCreatedAt = parseDate(candidate.created_at)?.getTime() ?? 0
      const nextCreatedAt = parseDate(target.created_at)?.getTime() ?? 0

      if (nextCreatedAt > candidateCreatedAt) {
        byTier.set(tier, target)
      }
    }
  }

  return byTier
}

function toTierTargets(flattenedProblems, progressMap, targets, today) {
  const tierTargetByTier = getTierTargetByTier(targets, today)

  return TIER_IDS.map((tier) => {
    const rows = flattenedProblems.filter((problem) => problem.tier === tier).sort(sortByStudyOrder)
    const solved = rows.filter((problem) => isCompleteStatus(getProblemStatus(progressMap, problem))).length

    const byPhase = new Map()

    for (const row of rows) {
      const phase = row.phase
      if (!phase) {
        continue
      }

      const current = byPhase.get(phase) ?? {
        phase,
        name: row.phaseName || `Phase ${phase}`,
        total: 0,
        solved: 0,
      }

      current.total += 1
      if (isCompleteStatus(getProblemStatus(progressMap, row))) {
        current.solved += 1
      }

      byPhase.set(phase, current)
    }

    const phaseProgress = Array.from(byPhase.values())
      .sort((left, right) => left.phase - right.phase)
      .map((entry) => ({
        ...entry,
        percent: entry.total > 0 ? entry.solved / entry.total : 0,
      }))

    const nextProblems = rows
      .filter((row) => !isCompleteStatus(getProblemStatus(progressMap, row)))
      .map((row) => ({
        ...row,
        status: getProblemStatus(progressMap, row),
      }))

    const activeTarget = tierTargetByTier.get(tier) ?? null
    const deadlineMeta = getDeadlineMeta(activeTarget?.deadline, today)
    const remaining = Math.max(rows.length - solved, 0)
    const startedAt = parseDate(activeTarget?.created_at) ? startOfDay(parseDate(activeTarget.created_at)) : startOfDay(today)
    const elapsedDays = Math.max(1, diffInDays(startedAt, today) + 1)
    const solvedSinceStart = activeTarget
      ? rows.filter((row) => {
          const solvedAt = parseDate(
            progressMap.get(problemIdentityKey(row.problemKey || row.lc))?.solved_at,
          )
          return solvedAt ? startOfDay(solvedAt).getTime() >= startedAt.getTime() : false
        }).length
      : 0
    const requiredPerDay = activeTarget ? remaining / Math.max(deadlineMeta.daysLeft || 1, 1) : null
    const actualPerDay = activeTarget ? solvedSinceStart / elapsedDays : null
    const onTrack = activeTarget
      ? remaining === 0
        ? true
        : deadlineMeta.overdueDays > 0
          ? false
          : (actualPerDay ?? 0) >= (requiredPerDay ?? Number.MAX_SAFE_INTEGER)
      : null

    return {
      tier,
      total: rows.length,
      solved,
      remaining,
      percent: rows.length > 0 ? solved / rows.length : 0,
      phaseProgress,
      nextProblems,
      activeTarget,
      deadlineMeta,
      targetDaysElapsed: activeTarget ? elapsedDays : null,
      solvedSinceTargetStart: activeTarget ? solvedSinceStart : null,
      requiredPerDay,
      actualPerDay,
      onTrack,
    }
  })
}

function toRecentSolved(progressRows, problemsByIdentity) {
  return [...progressRows]
    .filter((row) => parseDate(row.solved_at))
    .sort((left, right) => {
      const leftDate = parseDate(left.solved_at)
      const rightDate = parseDate(right.solved_at)
      return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0)
    })
    .slice(0, 10)
    .map((row) => {
      const lc = toNumber(row.problem_lc)
      const identityKey = problemIdentityKey(row.problem_key ?? row.problem_lc)
      const problem = identityKey ? problemsByIdentity.get(identityKey) : null

      return {
        problemKey: problem?.problemKey || normalizeProblemKey(row.problem_key),
        lc,
        title: problem?.title || normalizeProblemKey(row.problem_key) || (lc !== null ? `LC ${lc}` : 'Problem'),
        type: problem?.type || row.problem_type || 'unknown',
        track: problem?.track || 'dsa',
        tier: problem?.tier || null,
        phase: problem?.phase || null,
        phaseOrder: problem?.phaseOrder || null,
        phaseName: problem?.phaseName || '',
        sourcePlatform: problem?.sourcePlatform || '',
        sourceProblemId: problem?.sourceProblemId || '',
        canonicalSourceUrl:
          problem?.canonicalSourceUrl ||
          problem?.sourceUrl ||
          problem?.leetcodeUrl ||
          problem?.neetcodeUrl ||
          '',
        solvedAt: row.solved_at,
        status: row.status || 'solved',
      }
    })
}

function normalizeProblemKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function toReviewQueue(progressRows, problemsByIdentity) {
  const now = new Date()
  const nowTime = now.getTime()

  const rows = []

  for (const row of progressRows) {
    const identityKey = problemIdentityKey(row.problem_key ?? row.problem_lc)
    if (!identityKey) {
      continue
    }

    const problem = problemsByIdentity.get(identityKey)
    if (!problem) {
      continue
    }

    const status = row.status || 'unsolved'
    const solvedAt = parseDate(row.solved_at)
    const reviewedAt = parseDate(row.last_reviewed)
    const dueAt = parseDate(row.review_due_at)

    let include = false
    let reason = ''
    let dueSort = Number.MAX_SAFE_INTEGER

    if (status === 'review') {
      include = true
      reason = 'Marked for review'
      dueSort = dueAt ? dueAt.getTime() : 0
    } else if (status === 'attempted') {
      include = true
      reason = 'Attempted, needs completion'
      dueSort = dueAt ? dueAt.getTime() : 1
    } else if (dueAt && dueAt.getTime() <= nowTime) {
      include = true
      reason = 'Review due'
      dueSort = dueAt.getTime()
    } else if (solvedAt) {
      const ageDays = Math.floor((nowTime - solvedAt.getTime()) / (1000 * 60 * 60 * 24))
      const reviewedAfterSolve = reviewedAt && reviewedAt.getTime() >= solvedAt.getTime()

      if (ageDays >= 14 && !reviewedAfterSolve) {
        include = true
        reason = `Solved ${ageDays}d ago, first review pending`
        dueSort = solvedAt.getTime()
      }
    }

    if (!include) {
      continue
    }

    rows.push({
      problemKey: normalizeProblemKey(row.problem_key) || problem.problemKey,
      lc: toNumber(row.problem_lc),
      title: problem.title,
      type: problem.type,
      track: problem.track,
      tier: problem.tier,
      phase: problem.phase,
      phaseOrder: problem.phaseOrder,
      phaseName: problem.phaseName || '',
      sourcePlatform: problem.sourcePlatform || '',
      sourceProblemId: problem.sourceProblemId || '',
      canonicalSourceUrl:
        problem.canonicalSourceUrl ||
        problem.sourceUrl ||
        problem.leetcodeUrl ||
        problem.neetcodeUrl ||
        '',
      status,
      reason,
      dueAt: dueAt ? dueAt.toISOString() : null,
      dueSort,
    })
  }

  return rows
    .sort((left, right) => {
      const statusDiff = priorityFromStatus(left.status) - priorityFromStatus(right.status)
      if (statusDiff !== 0) {
        return statusDiff
      }

      if (left.dueSort !== right.dueSort) {
        return left.dueSort - right.dueSort
      }

      return sortByStudyOrder(left, right)
    })
    .slice(0, 25)
}

function toTargetSummary(target, tierTargetsByTier, today) {
  const deadlineMeta = getDeadlineMeta(target.deadline, today)
  const targetValue = parseTargetValue(target.target_value)

  if (target.target_type === 'tier') {
    const tier = toNumber(targetValue.tier)
    const tierData = tier ? tierTargetsByTier.get(tier) : null
    const remaining = tierData?.remaining ?? null
    const total = tierData?.total ?? null
    const solved = tierData?.solved ?? null

    return {
      id: target.id,
      name: target.name,
      type: target.target_type,
      tier,
      deadline: target.deadline,
      deadlineMeta,
      progressText: total !== null ? `${solved}/${total}` : 'No tier data',
      detail:
        remaining !== null
          ? `${remaining} remaining${deadlineMeta.hasDeadline ? ` · ${deadlineMeta.daysLeft}d left` : ''}`
          : 'Tier target',
      percent: tierData?.percent ?? 0,
      onTrack: tierData?.onTrack ?? null,
    }
  }

  if (target.target_type === 'phase') {
    return {
      id: target.id,
      name: target.name,
      type: target.target_type,
      tier: null,
      deadline: target.deadline,
      deadlineMeta,
      progressText: `Phase ${toNumber(targetValue.phase) ?? '-'}`,
      detail: targetValue.description || 'Phase milestone',
      percent: null,
      onTrack: null,
    }
  }

  if (target.target_type === 'count') {
    return {
      id: target.id,
      name: target.name,
      type: target.target_type,
      tier: null,
      deadline: target.deadline,
      deadlineMeta,
      progressText: `${toNumber(targetValue.count) ?? '-'} problems`,
      detail: 'Count milestone',
      percent: null,
      onTrack: null,
    }
  }

  return {
    id: target.id,
    name: target.name,
    type: target.target_type,
    tier: null,
    deadline: target.deadline,
    deadlineMeta,
    progressText: 'Custom',
    detail: targetValue.description || 'Custom target',
    percent: null,
    onTrack: null,
  }
}

export function useDashboardData() {
  const { activeTrackKey } = useCurrentUser()
  const problemsState = useProblems()
  const progressState = useProgress()
  const targetsState = useTargets({ activeOnly: true })

  const loading = problemsState.loading || progressState.loading || targetsState.loading
  const error = problemsState.error ?? progressState.error ?? targetsState.error ?? null

  return useMemo(() => {
    const flattenedProblems = flattenProblems(problemsState.data ?? []).filter(
      (problem) => (problem.track || 'dsa') === activeTrackKey,
    )
    const visibleIdentityKeys = new Set(
      flattenedProblems.map((problem) => problemIdentityKey(problem.problemKey || problem.lc)).filter(Boolean),
    )
    const progressRows = progressState.data ?? []
    const targets = (targetsState.data ?? []).filter((target) => !target.completed_at)
    const progressMap = createProgressMap(progressRows)
    const today = startOfDay(new Date())

    const problemsByIdentity = new Map(
      flattenedProblems.map((problem) => [problemIdentityKey(problem.problemKey || problem.lc), problem]),
    )
    const tierTargets = toTierTargets(flattenedProblems, progressMap, targets, today)
    const tierTargetsByTier = new Map(tierTargets.map((tier) => [tier.tier, tier]))

    const solvedOverall = flattenedProblems.filter((problem) =>
      isCompleteStatus(getProblemStatus(progressMap, problem)),
    ).length

    const tierStats = tierTargets.map((tier) => ({
      tier: tier.tier,
      total: tier.total,
      solved: tier.solved,
      percent: tier.percent,
    }))

    const phaseStats = buildPhaseStats(flattenedProblems, progressMap)

    const upNext = flattenedProblems
      .filter((row) => !isCompleteStatus(getProblemStatus(progressMap, row)))
      .sort(sortByStudyOrder)
      .slice(0, 10)
      .map((row) => ({
        ...row,
        status: getProblemStatus(progressMap, row),
      }))

    const solvedSeries = buildSolvedSeries(progressRows, 30)
    const velocity = {
      average7: getAverage(solvedSeries, 7),
      average15: getAverage(solvedSeries, 15),
      average30: getAverage(solvedSeries, 30),
      series30: solvedSeries,
      solved30: solvedSeries.reduce((sum, day) => sum + day.count, 0),
    }

    const filteredProgressRows = progressRows.filter((row) =>
      visibleIdentityKeys.has(problemIdentityKey(row.problem_key ?? row.problem_lc)),
    )
    const recentSolved = toRecentSolved(filteredProgressRows, problemsByIdentity)
    const reviewQueue = toReviewQueue(filteredProgressRows, problemsByIdentity)
    const targetSummaries = targets
      .map((target) => toTargetSummary(target, tierTargetsByTier, today))
      .sort((left, right) => left.deadlineMeta.deadlineSort - right.deadlineMeta.deadlineSort)

    const tierFocusByTarget = tierTargets
      .filter((tier) => tier.activeTarget && tier.remaining > 0)
      .sort((left, right) => left.deadlineMeta.deadlineSort - right.deadlineMeta.deadlineSort)[0]

    const fallbackTierFocus = tierTargets.find((tier) => tier.remaining > 0) ?? tierTargets[0] ?? null
    const focusTier = tierFocusByTarget?.tier ?? fallbackTierFocus?.tier ?? 1
    const focusReason = tierFocusByTarget
      ? `Using active target: ${tierFocusByTarget.activeTarget.name}`
      : 'No active tier deadline. Following tier order.'

    const resumeProblem = (tierTargetsByTier.get(focusTier)?.nextProblems ?? [])[0] ?? upNext[0] ?? null
    const totalProblems = flattenedProblems.length

    return {
      loading,
      error,
      overallSolved: Math.min(solvedOverall, totalProblems),
      overallTotal: totalProblems,
      tierStats,
      tierTargets,
      phaseStats,
      upNext,
      resumeProblem,
      recentSolved,
      reviewQueue,
      velocity,
      targets,
      targetSummaries,
      focusTier,
      focusReason,
    }
  }, [activeTrackKey, error, loading, problemsState.data, progressState.data, targetsState.data])
}
