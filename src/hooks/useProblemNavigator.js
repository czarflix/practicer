import { useMemo } from 'react'
import { useCurrentUser } from '../context/user-store'
import { useProblems } from './useProblems'
import { flattenProblems, problemIdentityKey, sortByStudyOrder } from '../lib/problem-utils'

function buildTierBuckets(rows) {
  const grouped = new Map()

  for (const row of rows) {
    const tier = Number(row?.tier ?? 0)
    if (!grouped.has(tier)) {
      grouped.set(tier, [])
    }
    grouped.get(tier).push(row)
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([tier, tierRows]) => ({
      tier,
      problems: [...tierRows].sort(sortByStudyOrder),
    }))
}

function buildPhaseBucket(rows, phase) {
  if (!phase) {
    return []
  }

  return rows.filter((row) => Number(row?.phase ?? 0) === Number(phase)).sort(sortByStudyOrder)
}

/**
 * Builds the full study-order sequence and returns prev/next problem identities
 * relative to the current problem.
 *
 * @param {string|number|null} currentProblem - the canonical problem key or LC number
 */
export function useProblemNavigator(currentProblem) {
  const { data: rawProblems } = useProblems()
  const { activeTrackKey } = useCurrentUser()

  const orderedProblems = useMemo(() => {
    const flattened = flattenProblems(rawProblems ?? []).filter(
      (row) => (row.track || 'dsa') === activeTrackKey,
    )
    flattened.sort(sortByStudyOrder)
    // deduplicate by canonical identity while preserving order
    const seen = new Set()
    const result = []
    for (const row of flattened) {
      const identity = problemIdentityKey(row.problemKey || row.lc)
      if (!identity || seen.has(identity)) {
        continue
      }

      seen.add(identity)
      result.push({
        ...row,
        identity,
        problemKey: row.problemKey || null,
        lc: row.lc,
        title: row.title,
      })
    }
    return result
  }, [activeTrackKey, rawProblems])

  const tierBuckets = useMemo(() => buildTierBuckets(orderedProblems), [orderedProblems])

  return useMemo(() => {
    const currentIdentity = problemIdentityKey(currentProblem)

    if (!currentIdentity || orderedProblems.length === 0) {
      return {
        prevProblem: null,
        nextProblem: null,
        prevInPhase: null,
        nextInPhase: null,
        prevLc: null,
        nextLc: null,
        isFirst: true,
        isLast: true,
        position: null,
        total: 0,
        phasePosition: null,
        phaseTotal: 0,
        tier: null,
      }
    }

    let currentTierIndex = -1
    let currentProblemIndex = -1

    for (let tierIndex = 0; tierIndex < tierBuckets.length; tierIndex += 1) {
      const problemIndex = tierBuckets[tierIndex].problems.findIndex((row) => row.identity === currentIdentity)
      if (problemIndex >= 0) {
        currentTierIndex = tierIndex
        currentProblemIndex = problemIndex
        break
      }
    }

    if (currentTierIndex < 0 || currentProblemIndex < 0) {
      return {
        prevProblem: null,
        nextProblem: null,
        prevInPhase: null,
        nextInPhase: null,
        prevLc: null,
        nextLc: null,
        isFirst: true,
        isLast: true,
        position: null,
        total: orderedProblems.length,
        phasePosition: null,
        phaseTotal: 0,
        tier: null,
      }
    }

    const currentBucket = tierBuckets[currentTierIndex]
    const currentProblemRow = currentBucket.problems[currentProblemIndex]
    const currentPhaseProblems = buildPhaseBucket(currentBucket.problems, currentProblemRow?.phase)
    const currentPhaseIndex = currentPhaseProblems.findIndex((row) => row.identity === currentIdentity)
    const prevProblem =
      currentProblemIndex > 0
        ? currentBucket.problems[currentProblemIndex - 1]
        : currentTierIndex > 0
          ? tierBuckets[currentTierIndex - 1].problems[tierBuckets[currentTierIndex - 1].problems.length - 1] ?? null
          : null
    const nextProblem =
      currentProblemIndex < currentBucket.problems.length - 1
        ? currentBucket.problems[currentProblemIndex + 1]
        : currentTierIndex < tierBuckets.length - 1
          ? tierBuckets[currentTierIndex + 1].problems[0] ?? null
          : null
    const prevInPhase = currentPhaseIndex > 0 ? currentPhaseProblems[currentPhaseIndex - 1] : null
    const nextInPhase =
      currentPhaseIndex >= 0 && currentPhaseIndex < currentPhaseProblems.length - 1
        ? currentPhaseProblems[currentPhaseIndex + 1]
        : null

    return {
      prevProblem,
      nextProblem,
      prevInPhase,
      nextInPhase,
      prevLc: prevProblem?.lc ?? null,
      nextLc: nextProblem?.lc ?? null,
      isFirst: currentTierIndex === 0 && currentProblemIndex === 0,
      isLast:
        currentTierIndex === tierBuckets.length - 1 &&
        currentProblemIndex === currentBucket.problems.length - 1,
      position: currentProblemIndex + 1,
      total: currentBucket.problems.length,
      tier: currentBucket.tier,
      phasePosition: currentPhaseIndex >= 0 ? currentPhaseIndex + 1 : null,
      phaseTotal: currentPhaseProblems.length,
    }
  }, [currentProblem, orderedProblems, tierBuckets])
}
