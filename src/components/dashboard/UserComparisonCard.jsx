import { useEffect, useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { motion as Motion } from 'framer-motion'
import { CustomSelect } from '../ui/CustomSelect'
import { useCurrentUser } from '../../context/user-store'
import { useProblems } from '../../hooks/useProblems'
import { useProgress } from '../../hooks/useProgress'
import { flattenProblems, problemIdentityKey } from '../../lib/problem-utils'
import { supabase } from '../../lib/supabase'

const DIFF_COLORS = { Easy: '#22c55e', Medium: '#f59e0b', Hard: '#ef4444' }
const revealTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] }

function MiniBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)_56px] items-center gap-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">{label}</span>
      <div className="h-2 min-w-0 overflow-hidden bg-border-subtle/30">
        <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color || 'var(--color-accent)' }} />
      </div>
      <span className="text-right font-mono text-[10px] text-text-muted">
        {value}/{max}
      </span>
    </div>
  )
}

function UserCol({ label, progress, problemMap, totalProblems, difficultyTotals }) {
  const solved = progress.filter((p) => p.status === 'solved')
  const diff = { Easy: 0, Medium: 0, Hard: 0 }
  for (const p of solved) {
    const m = problemMap.get(problemIdentityKey(p.problem_key ?? p.problem_lc))
    if (m) diff[m.difficulty] = (diff[m.difficulty] || 0) + 1
  }

  // Daily solves (last 7 days)
  const now = new Date()
  const daily = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const ds = d.toISOString().substring(0, 10)
    daily.push({
      label: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
      count: solved.filter((p) => p.solved_at && p.solved_at.substring(0, 10) === ds).length,
    })
  }
  const maxDaily = Math.max(...daily.map((d) => d.count), 1)

  return (
    <div className="min-w-0 flex-1 px-2 py-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</p>
      <div className="mt-1.5 flex items-end gap-2">
        <p className="font-mono text-2xl leading-none text-text-primary">
          {solved.length}<span className="text-sm text-text-muted">/{totalProblems}</span>
        </p>
        <p className="text-[11px] text-text-muted">{totalProblems > 0 ? Math.round((solved.length / totalProblems) * 100) : 0}% done</p>
      </div>

      <div className="mt-3 space-y-1.5">
        <MiniBar label="Easy" value={diff.Easy} max={difficultyTotals.Easy} color={DIFF_COLORS.Easy} />
        <MiniBar label="Medium" value={diff.Medium} max={difficultyTotals.Medium} color={DIFF_COLORS.Medium} />
        <MiniBar label="Hard" value={diff.Hard} max={difficultyTotals.Hard} color={DIFF_COLORS.Hard} />
      </div>

      <div className="mt-3 flex items-end gap-1" style={{ height: 24 }}>
        {daily.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full bg-accent/80 transition-all duration-300"
              style={{ height: `${Math.max((d.count / maxDaily) * 100, 1)}%`, opacity: d.count === 0 ? 0.15 : 1 }}
            />
            <span className="text-[8px] uppercase text-text-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function UserComparisonCard({ mode = 'compare' }) {
  const { userKey, activeTrackKey } = useCurrentUser()
  const [users, setUsers] = useState([])
  const [compareUser, setCompareUser] = useState('')
  const myProgressState = useProgress(userKey)
  const otherProgressState = useProgress(mode === 'compare' ? compareUser : null)

  const problemsState = useProblems()
  const allFlat = useMemo(
    () => flattenProblems(problemsState.data ?? []).filter((row) => (row.track || 'dsa') === activeTrackKey),
    [activeTrackKey, problemsState.data],
  )
  const totalProblems = allFlat.length
  const difficultyTotals = useMemo(
    () =>
      allFlat.reduce(
        (acc, row) => {
          if (row.difficulty && acc[row.difficulty] !== undefined) {
            acc[row.difficulty] += 1
          }
          return acc
        },
        { Easy: 0, Medium: 0, Hard: 0 },
      ),
    [allFlat],
  )
  const problemMap = useMemo(() => {
    const map = new Map()
    for (const row of allFlat) {
      const key = problemIdentityKey(row.problemKey || row.lc)
      if (key) {
        map.set(key, row)
      }
    }
    return map
  }, [allFlat])

  // Load other users — auto-select first
  useEffect(() => {
    if (!supabase || !userKey) return
    const go = async () => {
      try {
        const { data } = await supabase.from('app_users').select('user_key, display_name').neq('user_key', 'SYSTEM').neq('user_key', userKey).order('display_name')
        const list = data ?? []
        setUsers(list)
        if (mode === 'compare' && list.length > 0) {
          setCompareUser((prev) => prev || list[0].user_key)
        }
      } catch { setUsers([]) }
    }
    void go()
  }, [mode, userKey])

  const visibleIdentityKeys = useMemo(
    () => new Set(allFlat.map((row) => problemIdentityKey(row.problemKey || row.lc)).filter(Boolean)),
    [allFlat],
  )

  const filteredMyProgress = useMemo(
    () => (myProgressState.data ?? []).filter((row) => visibleIdentityKeys.has(problemIdentityKey(row.problem_key ?? row.problem_lc))),
    [myProgressState.data, visibleIdentityKeys],
  )

  const filteredOtherProgress = useMemo(
    () => (otherProgressState.data ?? []).filter((row) => visibleIdentityKeys.has(problemIdentityKey(row.problem_key ?? row.problem_lc))),
    [otherProgressState.data, visibleIdentityKeys],
  )

  const handleSelect = (val) => {
    setCompareUser(val)
  }

  const otherDisplay = users.find((u) => u.user_key === compareUser)?.display_name || compareUser

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...revealTransition, delay: 0.14 }}
      className="overflow-hidden border border-border-subtle bg-surface"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <Users size={12} className="text-text-muted" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            {mode === 'mine' ? 'Progress' : 'Compare'}
          </p>
        </div>
        {mode === 'compare' ? (
          <div className="w-32">
            <CustomSelect
              value={compareUser}
              onChange={handleSelect}
              options={users.map((u) => ({ value: u.user_key, label: u.display_name }))}
              placeholder="Select user…"
            />
          </div>
        ) : null}
      </div>

      <div className="px-3 py-2.5">
        {mode === 'compare' && !compareUser ? (
          <p className="py-2 text-center text-[11px] text-text-muted">Select a user to compare progress</p>
        ) : myProgressState.loading || myProgressState.isFetching || (mode === 'compare' && (otherProgressState.loading || otherProgressState.isFetching)) ? (
          <p className="py-2 text-center text-[11px] text-text-muted">Loading…</p>
        ) : (
          <div className={mode === 'compare' ? 'grid gap-3 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]' : 'grid gap-3'}>
            <UserCol
              label="You"
              progress={filteredMyProgress}
              problemMap={problemMap}
              totalProblems={totalProblems}
              difficultyTotals={difficultyTotals}
            />
            {mode === 'compare' ? <div className="hidden bg-border-subtle md:block" /> : null}
            {mode === 'compare' ? (
              <UserCol
                label={otherDisplay}
                progress={filteredOtherProgress}
                problemMap={problemMap}
                totalProblems={totalProblems}
                difficultyTotals={difficultyTotals}
              />
            ) : null}
          </div>
        )}
      </div>
    </Motion.section>
  )
}
