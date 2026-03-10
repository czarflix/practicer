import { useState } from 'react'
import { motion as Motion } from 'framer-motion'
import {
  ChartNoAxesCombined,
  Clock3,
  Database,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PlatformSymbol } from '../components/ui/PlatformSymbol'
import { StatusDot } from '../components/ui/StatusDot'
import { UserComparisonCard } from '../components/dashboard/UserComparisonCard'
import { useCurrentUser } from '../context/user-store'
import { useDashboardData } from '../hooks/useDashboardData'
import { useDashboardGreeting } from '../hooks/useDashboardGreeting'
import { useUserSettings } from '../hooks/useUserSettings'
import { cardHover, REVEAL_TRANSITION, sectionReveal, staggerContainer } from '../lib/motion'
import { formatDate, phaseLabel, problemUrl, sourcePlatformForProblem } from '../lib/problem-utils'

const tierLabels = ['Tier 1', 'Tier 2', 'Tier 3']

function toFixed(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '--'
}

function toDaysLabel(deadlineMeta) {
  if (!deadlineMeta?.hasDeadline) {
    return 'No deadline'
  }

  if (deadlineMeta.overdueDays > 0) {
    return `${deadlineMeta.overdueDays}d overdue`
  }

  if (deadlineMeta.daysLeft === 0) {
    return 'Due today'
  }

  return `${deadlineMeta.daysLeft}d left`
}


function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value * 100))
}



function trackLabel(onTrack) {
  if (onTrack === null) {
    return 'No track'
  }

  return onTrack ? 'On track' : 'Behind'
}



function MetricCell({ label, value, tone = 'primary' }) {
  return (
    <div className="border border-border-subtle bg-base px-2 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm ${tone === 'accent' ? 'text-accent' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}

function TierSegment({ tierTargets, activeTier, setActiveTier }) {
  const activeIndex = tierTargets.findIndex((tier) => tier.tier === activeTier)
  const width = 100 / Math.max(1, tierTargets.length)

  return (
    <div className="relative grid grid-cols-3 border border-border-subtle bg-base">
      <Motion.span
        initial={false}
        animate={{ left: `${Math.max(activeIndex, 0) * width}%` }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        style={{ width: `${width}%` }}
        className="pointer-events-none absolute inset-y-0 z-[1] border border-accent bg-accent/10"
      />

      {tierTargets.map((target) => {
        const selected = target.tier === activeTier
        return (
          <button
            key={`tier-switch-${target.tier}`}
            type="button"
            onClick={() => setActiveTier(target.tier)}
            className={[
              'relative z-[2] h-8 border-r border-border-subtle text-xs last:border-r-0',
              selected ? 'text-accent' : 'text-text-muted hover:text-text-primary',
            ].join(' ')}
          >
            {tierLabels[target.tier - 1]}
          </button>
        )
      })}
    </div>
  )
}

function TierFocusCard({ tierTargets, activeTier, setActiveTier }) {
  const activeTarget = tierTargets.find((target) => target.tier === activeTier) ?? tierTargets[0] ?? null

  if (!activeTarget) {
    return null
  }

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={REVEAL_TRANSITION}
      className="border border-border-subtle bg-surface p-2.5"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Tier Focus</p>
          <h2 className="mt-0.5 text-sm text-text-primary">{tierLabels[activeTarget.tier - 1]}</h2>
        </div>
        <p className="font-mono text-[11px] text-text-muted">{toDaysLabel(activeTarget.deadlineMeta)}</p>
      </div>

      <p className="mt-1 truncate text-[11px] text-text-muted">
        {activeTarget.activeTarget ? activeTarget.activeTarget.name : 'No active tier target. Using default tier order.'}
      </p>

      <div className="mt-2 text-xs">
        <TierSegment tierTargets={tierTargets} activeTier={activeTier} setActiveTier={setActiveTier} />
      </div>

      <div className="mt-2 h-1.5 overflow-hidden border border-border-subtle bg-base">
        <Motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clampPercent(activeTarget.percent)}%` }}
          transition={REVEAL_TRANSITION}
          className="h-full bg-accent"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <MetricCell label="Solved" value={`${activeTarget.solved}/${activeTarget.total}`} />
        <MetricCell label="Remaining" value={String(activeTarget.remaining)} />
        <MetricCell label="Required / Day" value={toFixed(activeTarget.requiredPerDay)} />
        <MetricCell
          label={`${trackLabel(activeTarget.onTrack)} · Actual / Day`}
          value={toFixed(activeTarget.actualPerDay)}
          tone={activeTarget.onTrack === false ? 'primary' : 'accent'}
        />
      </div>
    </Motion.section>
  )
}

function VelocityCard({ velocity }) {
  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...REVEAL_TRANSITION, delay: 0.03 }}
      className="flex min-h-0 flex-col border border-border-subtle bg-surface p-2.5"
    >
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Solve Velocity</p>
        <ChartNoAxesCombined size={14} className="text-text-muted" />
      </div>

      <div className="mt-2 shrink-0 grid grid-cols-3 gap-1.5">
        <MetricCell label="7d" value={toFixed(velocity.average7)} />
        <MetricCell label="14d" value={toFixed(velocity.average15)} />
        <MetricCell label="30d" value={toFixed(velocity.average30)} />
      </div>
    </Motion.section>
  )
}

function MetaChip({ children }) {
  return (
    <span className="inline-flex items-center border border-border-subtle bg-base px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
      {children}
    </span>
  )
}

function QueueMeta({ item, trailing = null }) {
  const phaseText = item.phaseName || phaseLabel(item) || 'No phase'
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <PlatformSymbol platform={sourcePlatformForProblem(item)} size="sm" />
      <MetaChip>{item.tier ? `Tier ${item.tier}` : 'Tier -'}</MetaChip>
      <span className="truncate text-[11px] text-text-muted">{phaseText}</span>
      {trailing}
    </div>
  )
}



function QueueCard({ title, icon, rows, empty, renderRow, delay = 0 }) {
  const IconComponent = icon

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...REVEAL_TRANSITION, delay }}
      className="flex min-h-0 flex-col border border-border-subtle bg-surface"
    >
      <header className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="inline-flex items-center gap-2">
          <IconComponent size={13} className="text-text-muted" />
          <h2 className="text-sm text-text-primary">{title}</h2>
        </div>
        <p className="font-mono text-[11px] text-text-muted">{rows.length}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {rows.length === 0 ? <p className="px-3 py-3 text-sm text-text-muted">{empty}</p> : null}
        {rows.length > 0 ? <ul className="divide-y divide-border-subtle">{rows.map(renderRow)}</ul> : null}
      </div>
    </Motion.section>
  )
}

function DashboardLoadingState() {
  return (
    <section className="border border-border-subtle bg-surface p-4">
      <div className="animate-pulse space-y-2">
        <div className="h-4 w-56 bg-elevated" />
        <div className="h-2 w-full bg-elevated" />
        <div className="h-2 w-[72%] bg-elevated" />
      </div>
    </section>
  )
}

function DashboardErrorState({ message }) {
  return (
    <section className="border border-border-subtle bg-surface p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-text-muted">Connection Error</p>
      <p className="mt-2 text-sm text-text-primary">{message}</p>
    </section>
  )
}

export function DashboardPage() {
  const { userKey, activeUser, activeTrackKey } = useCurrentUser()
  const { settings } = useUserSettings(userKey)
  const {
    loading,
    error,
    tierTargets,
    recentSolved,
    reviewQueue,
    velocity,
    focusTier,
  } = useDashboardData()

  const [activeTierOverride, setActiveTierOverride] = useState(null)

  const activeTier = (() => {
    if (activeTierOverride !== null && tierTargets.some((tier) => tier.tier === activeTierOverride)) {
      return activeTierOverride
    }

    return focusTier
  })()

  const activeTrackLabel = activeTrackKey === 'sql' ? 'SQL' : 'DSA'
  const ActiveTrackIcon = activeTrackKey === 'sql' ? Database : ShieldCheck
  const greeting = useDashboardGreeting({ user: activeUser })

  return (
    <section className="flex h-[100dvh] w-full flex-col gap-3 overflow-hidden p-3 md:p-4">
      {loading ? <DashboardLoadingState /> : null}
      {!loading && error ? <DashboardErrorState message={error.message} /> : null}

      {!loading && !error ? (
        <>
          <Motion.section
            variants={sectionReveal}
            initial="hidden"
            animate="visible"
            className="shrink-0 border border-border-subtle bg-surface px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-text-primary md:text-[1.35rem]">
                  {greeting.headline}
                </h1>
                {greeting.subline ? (
                  <p className="mt-1 truncate text-[12px] leading-5 text-text-muted md:text-[13px]">
                    {greeting.subline}
                  </p>
                ) : null}
              </div>
              <div className="inline-flex shrink-0 items-center gap-1.5 border border-border-subtle bg-base px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                <ActiveTrackIcon size={12} strokeWidth={2} className="text-text-primary" />
                <span>{activeTrackLabel}</span>
              </div>
            </div>
          </Motion.section>

          <Motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]"
          >
            <div className="flex min-h-0 flex-col gap-3">
              <UserComparisonCard mode={settings.dashboard_comparison_mode ?? 'compare'} />
              <div className="grid min-h-0 gap-3 2xl:grid-cols-2">
                <TierFocusCard
                  tierTargets={tierTargets}
                  activeTier={activeTier}
                  setActiveTier={setActiveTierOverride}
                />
                <VelocityCard velocity={velocity} />
              </div>
            </div>

            <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <QueueCard
                title="Last 10 Solved"
                icon={ShieldCheck}
                rows={recentSolved}
                empty="No solved problems yet."
                delay={0.06}
                renderRow={(item) => (
                  <Motion.li
                    key={`solved-${item.problemKey || item.lc}-${item.solvedAt}`}
                    whileHover={cardHover.whileHover}
                    transition={cardHover.transition}
                    className="px-3 py-2"
                  >
                    <Link to={problemUrl(item)} className="flex min-w-0 items-start gap-2.5">
                      <StatusDot status={item.status} />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm leading-5 text-text-primary hover:text-accent">{item.title}</p>
                        <QueueMeta
                          item={item}
                          trailing={<span className="ml-auto font-mono text-[11px] text-text-muted">{formatDate(item.solvedAt)}</span>}
                        />
                      </div>
                    </Link>
                  </Motion.li>
                )}
              />

              <QueueCard
                title="Review / Redo Queue"
                icon={Clock3}
                rows={reviewQueue}
                empty="No review tasks right now."
                delay={0.1}
                renderRow={(item) => (
                  <Motion.li
                    key={`review-${item.problemKey || item.lc}`}
                    whileHover={cardHover.whileHover}
                    transition={cardHover.transition}
                    className="px-3 py-2"
                  >
                    <Link to={problemUrl(item)} className="flex min-w-0 items-start gap-2.5">
                      <StatusDot status={item.status} />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm leading-5 text-text-primary hover:text-accent">{item.title}</p>
                        <QueueMeta item={item} />
                        <p className="mt-1 break-words text-[11px] text-text-muted">{item.reason}</p>
                      </div>
                    </Link>
                  </Motion.li>
                )}
              />
            </div>
          </Motion.div>
        </>
      ) : null}
    </section>
  )
}
