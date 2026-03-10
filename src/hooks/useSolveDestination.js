import { useMemo } from 'react'
import { useCurrentUser } from '../context/user-store'
import { useProblems } from './useProblems'
import { useProgress } from './useProgress'
import { createProgressMap, flattenProblems, isCompleteStatus, problemIdentityKey, sortByStudyOrder } from '../lib/problem-utils'

function parseDate(value) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function activityTimestamp(row) {
  return (
    parseDate(row?.updated_at)?.getTime() ??
    parseDate(row?.last_reviewed)?.getTime() ??
    parseDate(row?.solved_at)?.getTime() ??
    0
  )
}

function buildTierBuckets(problems) {
  const grouped = new Map()

  for (const problem of problems) {
    const tier = Number(problem?.tier ?? 0)
    if (!grouped.has(tier)) {
      grouped.set(tier, [])
    }
    grouped.get(tier).push(problem)
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([tier, tierProblems]) => ({
      tier,
      problems: [...tierProblems].sort(sortByStudyOrder),
    }))
}

export function useSolveDestination() {
  const { activeTrackKey } = useCurrentUser()
  const problemsState = useProblems()
  const progressState = useProgress()

  return useMemo(() => {
    const flattenedProblems = flattenProblems(problemsState.data ?? [])
      .filter((problem) => (problem.track || 'dsa') === activeTrackKey)
      .sort(sortByStudyOrder)

    const orderedProblems = []
    const problemsByIdentity = new Map()
    const seen = new Set()

    for (const problem of flattenedProblems) {
      const identity = problemIdentityKey(problem.problemKey || problem.lc)
      if (!identity || seen.has(identity)) {
        continue
      }

      seen.add(identity)
      orderedProblems.push(problem)
      problemsByIdentity.set(identity, problem)
    }

    const visibleIdentityKeys = new Set(orderedProblems.map((problem) => problemIdentityKey(problem.problemKey || problem.lc)))
    const filteredProgressRows = (progressState.data ?? []).filter((row) =>
      visibleIdentityKeys.has(problemIdentityKey(row.problem_key ?? row.problem_lc)),
    )
    const progressMap = createProgressMap(filteredProgressRows)

    const activeAttempt = [...filteredProgressRows]
      .filter((row) => {
        const status = row.status ?? 'unsolved'
        if (isCompleteStatus(status)) {
          return false
        }
        return status !== 'unsolved' || Boolean(row.last_reviewed || row.updated_at)
      })
      .sort((left, right) => activityTimestamp(right) - activityTimestamp(left))[0]

    if (activeAttempt) {
      const identity = problemIdentityKey(activeAttempt.problem_key ?? activeAttempt.problem_lc)
      const problem = problemsByIdentity.get(identity) ?? null
      if (problem) {
        return {
          loading: problemsState.loading || progressState.loading,
          problem,
          reason: 'resume_active',
        }
      }
    }

    const tierBuckets = buildTierBuckets(orderedProblems)

    const latestSolved = [...filteredProgressRows]
      .filter((row) => isCompleteStatus(row.status) && parseDate(row.solved_at))
      .sort((left, right) => {
        const leftTime = parseDate(left.solved_at)?.getTime() ?? 0
        const rightTime = parseDate(right.solved_at)?.getTime() ?? 0
        return rightTime - leftTime
      })[0]

    if (latestSolved) {
      const solvedIdentity = problemIdentityKey(latestSolved.problem_key ?? latestSolved.problem_lc)
      let nextProblem = null

      for (let tierIndex = 0; tierIndex < tierBuckets.length; tierIndex += 1) {
        const bucket = tierBuckets[tierIndex]
        const problemIndex = bucket.problems.findIndex(
          (problem) => problemIdentityKey(problem.problemKey || problem.lc) === solvedIdentity,
        )

        if (problemIndex < 0) {
          continue
        }

        if (problemIndex < bucket.problems.length - 1) {
          nextProblem = bucket.problems[problemIndex + 1]
        } else if (tierIndex < tierBuckets.length - 1) {
          nextProblem = tierBuckets[tierIndex + 1].problems[0] ?? null
        }
        break
      }

      if (nextProblem) {
        return {
          loading: problemsState.loading || progressState.loading,
          problem: nextProblem,
          reason: 'next_after_solved',
        }
      }
    }

    let nextUnsolved = null
    for (const bucket of tierBuckets) {
      nextUnsolved = bucket.problems.find(
        (problem) => !isCompleteStatus(progressMap.get(problemIdentityKey(problem.problemKey || problem.lc))?.status),
      )
      if (nextUnsolved) {
        break
      }
    }
    if (nextUnsolved) {
      return {
        loading: problemsState.loading || progressState.loading,
        problem: nextUnsolved,
        reason: 'first_unsolved',
      }
    }

    const firstProblem = tierBuckets[0]?.problems[0] ?? null
    return {
      loading: problemsState.loading || progressState.loading,
      problem: firstProblem,
      reason: firstProblem ? 'restart_track' : 'none',
    }
  }, [activeTrackKey, problemsState.data, problemsState.loading, progressState.data, progressState.loading])
}
