import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatusDot } from '../components/ui/StatusDot'
import { useProblems } from '../hooks/useProblems'
import { useProgress } from '../hooks/useProgress'
import {
  buildPhaseStats,
  clampPercent,
  createProgressMap,
  flattenProblems,
  getProblemStatus,
  problemUrl,
  sortByStudyOrder,
} from '../lib/problem-utils'

export function PhasesPage() {
  const problemsState = useProblems()
  const progressState = useProgress()
  const [expandedPhase, setExpandedPhase] = useState(null)

  const loading = problemsState.loading || progressState.loading
  const error = problemsState.error ?? progressState.error

  const phases = useMemo(() => {
    const flattened = flattenProblems(problemsState.data ?? []).sort(sortByStudyOrder)
    const progressMap = createProgressMap(progressState.data ?? [])

    return buildPhaseStats(flattened, progressMap).map((phase) => ({
      ...phase,
      problems: phase.problems.map((problem) => ({
        ...problem,
        status: getProblemStatus(progressMap, problem.lc),
      })),
    }))
  }, [problemsState.data, progressState.data])

  const activePhaseOrder = phases.find((phase) => phase.total > 0 && phase.percent < 1)?.order ?? phases[0]?.order

  return (
    <section className="mx-auto w-full max-w-[1280px] p-4 md:p-6">
      <div className="border border-border-subtle bg-surface">
        <header className="border-b border-border-subtle px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Curriculum</p>
          <h1 className="mt-1 text-lg font-medium text-text-primary">Phase View</h1>
        </header>

        {loading ? <div className="px-3 py-4 text-sm text-text-muted">Loading phases...</div> : null}
        {!loading && error ? <div className="px-3 py-4 text-sm text-text-primary">{error.message}</div> : null}

        {!loading && !error ? (
          <div>
            {phases.map((phase) => {
              const expanded = expandedPhase === phase.order
              const isActive = phase.order === activePhaseOrder
              const tierSummary = phase.tierStats
                .map((tierStat) => `T${tierStat.tier}: ${tierStat.solved}/${tierStat.total}`)
                .join(' · ')

              return (
                <div key={phase.order} className="border-b border-border-subtle">
                  <button
                    type="button"
                    onClick={() => setExpandedPhase((current) => (current === phase.order ? null : phase.order))}
                    className="grid w-full grid-cols-[24px_72px_minmax(0,1fr)_180px_220px] items-center gap-2 px-3 py-2 text-left hover:bg-base"
                  >
                    <span className="text-text-muted">
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">Phase {phase.order}</span>
                    <span className={isActive ? 'text-sm text-accent' : 'text-sm text-text-primary'}>{phase.name}</span>
                    <div className="h-2 overflow-hidden border border-border-subtle bg-base">
                      <div className="h-full bg-text-primary" style={{ width: `${clampPercent(phase.percent)}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-muted">{tierSummary}</span>
                  </button>

                  {expanded ? (
                    <div className="border-t border-border-subtle bg-base/40">
                      {phase.problems.length === 0 ? (
                        <p className="px-8 py-3 text-sm text-text-muted">No problems configured in this phase.</p>
                      ) : (
                        <ul>
                          {phase.problems.map((problem) => (
                            <li
                              key={`${phase.order}-${problem.type}-${problem.lc}`}
                              className="grid grid-cols-[24px_minmax(0,1fr)_70px_64px] items-center gap-2 border-b border-border-subtle px-8 py-2"
                            >
                              <StatusDot status={problem.status} />
                              <Link to={problemUrl(problem.lc, problem.title)} className="truncate text-sm text-text-primary hover:text-accent">
                                {problem.title}
                                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                                  {problem.type}
                                </span>
                              </Link>
                              <span className="font-mono text-[11px] text-text-muted">LC {problem.lc}</span>
                              <span className="text-right text-[11px] text-text-muted">T{problem.tier}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </section>
  )
}
