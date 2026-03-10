import { useEffect, useMemo, useRef, useState } from 'react'
import { motion as Motion } from 'framer-motion'
import { ExternalLink, RefreshCcw, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { CompanySymbols } from '../components/ui/CompanySymbols'
import { CustomSelect } from '../components/ui/CustomSelect'
import { PlatformSymbol } from '../components/ui/PlatformSymbol'
import { StatusDot } from '../components/ui/StatusDot'
import { useCurrentUser } from '../context/user-store'
import { useProblems } from '../hooks/useProblems'
import { useProgress } from '../hooks/useProgress'
import {
  clampPercent,
  createProgressMap,
  difficultySortValue,
  flattenProblems,
  fuzzyIncludes,
  getProblemStatus,
  phaseLabel,
  problemUrl,
  sortByStudyOrder,
  sourcePlatformForProblem,
  sourceUrlForProblem,
} from '../lib/problem-utils'
import { cardHover, sectionReveal, staggerContainer } from '../lib/motion'

function queryMatches(row, query) {
  const searchText = [
    row.title,
    row.lc,
    row.problemKey,
    row.phaseName,
    row.type,
    row.track,
    row.difficulty,
    row.sourcePlatform,
    row.sourceProblemId,
    row.companies.join(' '),
  ].join(' ')

  return fuzzyIncludes(query, searchText)
}

function normalizeChoice(value, validValues) {
  if (typeof value !== 'string') {
    return 'all'
  }

  return validValues.has(value) ? value : 'all'
}

function normalizePhaseValue(value) {
  if (typeof value !== 'string') {
    return 'all'
  }

  return /^\d+$/.test(value) ? value : 'all'
}

function ToolbarStat({ label, value }) {
  return (
    <div className="border border-border-subtle bg-base px-2 py-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">{label}</p>
      <p className="font-mono text-xs text-text-primary">{value}</p>
    </div>
  )
}

export function ProblemsPage() {
  const problemsState = useProblems()
  const progressState = useProgress()
  const { activeTrackKey } = useCurrentUser()
  const [searchParams, setSearchParams] = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [tierFilter, setTierFilter] = useState(() =>
    normalizeChoice(searchParams.get('tier'), new Set(['1', '2', '3'])),
  )
  const [phaseFilter, setPhaseFilter] = useState(() => normalizePhaseValue(searchParams.get('phase')))
  const [difficultyFilter, setDifficultyFilter] = useState(searchParams.get('difficulty') || 'all')
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') || 'all')
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeChoice(searchParams.get('status'), new Set(['unsolved', 'attempted', 'review', 'solved'])),
  )
  const filterBarRef = useRef(null)
  const [filterBarHeight, setFilterBarHeight] = useState(0)

  const progressMap = useMemo(() => createProgressMap(progressState.data ?? []), [progressState.data])

  const rawRows = useMemo(() => {
    return flattenProblems(problemsState.data ?? []).map((row) => ({
      ...row,
      status: getProblemStatus(progressMap, row),
    }))
  }, [problemsState.data, progressMap])

  const trackRows = useMemo(() => {
    return rawRows.filter((row) => (row.track || 'dsa') === activeTrackKey)
  }, [activeTrackKey, rawRows])

  const phaseOptions = useMemo(() => {
    const options = new Map()
    for (const row of trackRows) {
      options.set(String(row.phase), row.phaseName || `Phase ${row.phase}`)
    }
    return Array.from(options.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))
  }, [trackRows])

  const difficultyOptions = useMemo(() => {
    return Array.from(new Set(trackRows.map((row) => row.difficulty))).sort(
      (left, right) => difficultySortValue(left) - difficultySortValue(right),
    )
  }, [trackRows])

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(trackRows.map((row) => sourcePlatformForProblem(row)).filter(Boolean))).sort()
  }, [trackRows])

  const tierSelectOptions = [
    { value: 'all', label: 'All Tiers' },
    { value: '1', label: 'Tier 1' },
    { value: '2', label: 'Tier 2' },
    { value: '3', label: 'Tier 3' },
  ]

  const phaseSelectOptions = [
    { value: 'all', label: 'All Phases' },
    ...phaseOptions.map(([value, label]) => ({ value, label: `${value}. ${label}` })),
  ]

  const difficultySelectOptions = [
    { value: 'all', label: 'All Difficulty' },
    ...difficultyOptions.map((d) => ({ value: d, label: d })),
  ]

  const sourceSelectOptions = [
    { value: 'all', label: 'All Sources' },
    ...sourceOptions.map((source) => ({ value: source, label: source })),
  ]

  const statusSelectOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'unsolved', label: 'Unsolved' },
    { value: 'attempted', label: 'Attempted' },
    { value: 'review', label: 'Review' },
    { value: 'solved', label: 'Solved' },
  ]

  const sortedRows = useMemo(() => {
    return [...trackRows].sort(sortByStudyOrder)
  }, [trackRows])

  const filteredRows = useMemo(() => {
    const nextRows = sortedRows.filter((row) => {
      if (!queryMatches(row, query)) {
        return false
      }

      if (phaseFilter !== 'all' && String(row.phase) !== phaseFilter) {
        return false
      }

      if (difficultyFilter !== 'all' && row.difficulty !== difficultyFilter) {
        return false
      }

      if (tierFilter !== 'all' && String(row.tier) !== tierFilter) {
        return false
      }

      if (sourceFilter !== 'all' && sourcePlatformForProblem(row) !== sourceFilter) {
        return false
      }

      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false
      }

      return true
    })

    return nextRows
  }, [
    difficultyFilter,
    phaseFilter,
    query,
    sortedRows,
    statusFilter,
    sourceFilter,
    tierFilter,
  ])

  const solvedCount = useMemo(
    () => trackRows.filter((row) => row.status === 'solved' || row.status === 'review').length,
    [trackRows],
  )

  const solvedPercent = trackRows.length > 0 ? solvedCount / trackRows.length : 0

  const loading = problemsState.loading || progressState.loading
  const error = problemsState.error ?? progressState.error

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams)
    const nextQuery = query.trim()

    if (nextQuery) {
      nextParams.set('q', nextQuery)
    } else {
      nextParams.delete('q')
    }

    if (tierFilter === 'all') {
      nextParams.delete('tier')
    } else {
      nextParams.set('tier', tierFilter)
    }

    if (phaseFilter === 'all') {
      nextParams.delete('phase')
    } else {
      nextParams.set('phase', phaseFilter)
    }

    if (difficultyFilter === 'all') {
      nextParams.delete('difficulty')
    } else {
      nextParams.set('difficulty', difficultyFilter)
    }

    if (sourceFilter === 'all') {
      nextParams.delete('source')
    } else {
      nextParams.set('source', sourceFilter)
    }

    if (statusFilter === 'all') {
      nextParams.delete('status')
    } else {
      nextParams.set('status', statusFilter)
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true })
    }
  }, [difficultyFilter, phaseFilter, query, searchParams, setSearchParams, sourceFilter, statusFilter, tierFilter])

  useEffect(() => {
    const element = filterBarRef.current
    if (!element) {
      return undefined
    }

    const syncHeight = () => {
      setFilterBarHeight(Math.round(element.getBoundingClientRect().height))
    }

    syncHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncHeight)
      return () => {
        window.removeEventListener('resize', syncHeight)
      }
    }

    const observer = new ResizeObserver(syncHeight)
    observer.observe(element)
    window.addEventListener('resize', syncHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncHeight)
    }
  }, [])

  return (
    <Motion.section
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="mx-auto h-full w-full max-w-[1400px] p-3 md:p-4"
      style={{ '--problems-filter-h': `${filterBarHeight}px` }}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Motion.header variants={sectionReveal} className="border-b border-border-subtle pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Library</p>
              <h1 className="mt-1 text-lg font-medium text-text-primary">
                {activeTrackKey === 'sql' ? 'SQL Problem List' : 'Problem List'}
              </h1>
            </div>
          </div>
        </Motion.header>

        <Motion.section variants={sectionReveal} className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <ToolbarStat label="Shown" value={`${filteredRows.length}`} />
          <ToolbarStat label="Total" value={`${trackRows.length}`} />
          <ToolbarStat label="Solved" value={`${solvedCount}`} />
          <ToolbarStat label="Completion" value={`${Math.round(clampPercent(solvedPercent))}%`} />
        </Motion.section>

        <Motion.section variants={sectionReveal} className="relative min-h-0 flex-1 overflow-hidden border border-border-subtle bg-surface">
          {loading ? (
            <div className="p-4 text-sm text-text-muted">Loading problems...</div>
          ) : null}

          {!loading && error ? <div className="p-4 text-sm text-text-primary">{error.message}</div> : null}

          {!loading && !error ? (
            <div className="h-full overflow-y-auto overflow-x-hidden">
              <section
                ref={filterBarRef}
                className="sticky top-0 z-40 border-b border-border-subtle bg-surface/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-surface/90"
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto]">
                  <label className="relative block">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
                      size={13}
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={activeTrackKey === 'sql' ? 'Search title, source, platform' : 'Search title, LC#, company'}
                      className="h-8 w-full border border-border-subtle bg-base pl-7 pr-2 text-xs text-text-primary outline-none focus:border-accent"
                    />
                  </label>

                  <CustomSelect value={tierFilter} onChange={setTierFilter} options={tierSelectOptions} className="min-w-[100px]" />
                  <CustomSelect value={phaseFilter} onChange={setPhaseFilter} options={phaseSelectOptions} className="min-w-[140px]" />
                  <CustomSelect value={difficultyFilter} onChange={setDifficultyFilter} options={difficultySelectOptions} className="min-w-[120px]" />
                  <CustomSelect value={sourceFilter} onChange={setSourceFilter} options={sourceSelectOptions} className="min-w-[130px]" />
                  <CustomSelect value={statusFilter} onChange={setStatusFilter} options={statusSelectOptions} className="min-w-[110px]" />
                </div>
              </section>

              <table className="w-full table-fixed border-collapse text-left text-[11px] leading-5">
                <colgroup>
                  <col className="w-[36%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[18%]" />
                  <col className="w-[5%]" />
                  <col className="w-[10%]" />
                  <col className="w-[7%]" />
                </colgroup>
                <thead>
                  <tr className="text-text-muted">
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Title
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Source
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Difficulty
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Phase
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Tier
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Status
                    </th>
                    <th className="sticky z-30 border-b border-border-subtle bg-base/95 px-2 py-2 font-medium backdrop-blur [top:var(--problems-filter-h)]">
                      Companies
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <Motion.tr
                      key={`${row.rowId}-${row.type}`}
                      whileHover={cardHover.whileHover}
                      transition={cardHover.transition}
                      className="border-b border-border-subtle/80 hover:bg-base/70"
                    >
                      <td className="px-2 py-1.5 align-middle">
                        <Link
                          to={problemUrl(row)}
                          className={[
                            'block break-words font-medium tracking-[-0.01em] text-text-primary transition-colors hover:text-accent',
                            activeTrackKey === 'sql' ? 'text-[13px] md:text-[14px]' : 'text-[13px]',
                          ].join(' ')}
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">
                        <a
                          href={sourceUrlForProblem(row) || undefined}
                          target={sourceUrlForProblem(row) ? '_blank' : undefined}
                          rel={sourceUrlForProblem(row) ? 'noreferrer' : undefined}
                          className={[
                            'inline-flex max-w-full items-center gap-1.5 text-text-primary',
                            sourceUrlForProblem(row) ? 'transition-colors hover:text-accent' : '',
                          ].join(' ')}
                        >
                          <PlatformSymbol
                            platform={sourcePlatformForProblem(row)}
                            size="sm"
                            className="shrink-0"
                          />
                          <span className="truncate text-xs">{sourcePlatformForProblem(row)}</span>
                          {sourceUrlForProblem(row) ? <ExternalLink size={10} className="shrink-0 text-text-muted" /> : null}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 text-text-primary">{row.difficulty}</td>
                      <td className="px-2 py-1.5 text-text-muted">
                        <span className="block truncate">{phaseLabel(row)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-text-primary">{row.tier ?? '-'}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <StatusDot status={row.status} />
                          <span className="truncate capitalize text-text-muted">{row.status}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-text-muted">
                        <CompanySymbols companies={row.companies} max={2} />
                      </td>
                    </Motion.tr>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-text-muted">
                        No problems match current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </Motion.section>
      </div>
    </Motion.section>
  )
}
