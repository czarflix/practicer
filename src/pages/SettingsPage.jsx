import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion as Motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  Send,
  Trash2,
  User,
} from 'lucide-react'

import { useCurrentUser } from '../context/user-store'
import { useNotificationPreferences } from '../hooks/useNotificationPreferences'
import { useTargets } from '../hooks/useTargets'
import { useUserSettings } from '../hooks/useUserSettings'
import { assistantRequest, isAssistantConfigured } from '../lib/assistant-client'
import { supabase, hasSupabaseCredentials } from '../lib/supabase'
import { formatDate } from '../lib/problem-utils'

const missingSupabaseMessage = 'Supabase not configured'
const revealTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] }

const tierLabels = ['Tier 1', 'Tier 2', 'Tier 3']

// ─── Notification type metadata ──────────────────────────────────────────────

const SEND_TYPES = [
  { type: 'comment_added', label: 'Comment on a problem' },
  { type: 'comment_replied', label: 'Reply to a comment' },
  { type: 'shared_solution', label: 'Share a solution' },
  { type: 'shared_note', label: 'Share a note' },
  { type: 'tier_completed', label: 'Complete a tier' },
]

const RECEIVE_COLLAB_TYPES = [
  { type: 'comment_added', label: 'Comments on a problem' },
  { type: 'comment_replied', label: 'Replies to a comment' },
  { type: 'shared_solution', label: 'Shares a solution' },
  { type: 'shared_note', label: 'Shares a note' },
  { type: 'problem_solved', label: 'Solves a problem' },
  { type: 'daily_solved_milestone', label: 'Reaches a solve milestone' },
  { type: 'tier_completed', label: 'Completes a tier' },
]

const RECEIVE_SYSTEM_TYPES = [
  { type: 'problem_added', label: 'New problem added' },
  { type: 'test_case_added', label: 'Test case added' },
  { type: 'test_case_updated', label: 'Test case updated' },
]

const BROADCAST_MODES = [
  { value: 'every_solve', label: 'Every solve' },
  { value: 'milestone', label: 'Milestone only' },
  { value: 'off', label: 'Off' },
]

const DASHBOARD_COMPARISON_MODES = [
  { value: 'compare', label: 'Compare' },
  { value: 'mine', label: 'Mine' },
]

const PREFERRED_MODE_OPTIONS = [
  { value: 'dsa', label: 'DSA' },
  { value: 'sql', label: 'SQL' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10)
}



function parseTargetValue(value) {
  if (!value) return {}
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

// ─── Small Components ────────────────────────────────────────────────────────

function BroadcastModeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const activeLabel = BROADCAST_MODES.find((m) => m.value === value)?.label ?? 'Every solve'

  useEffect(() => {
    if (!open) return undefined
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex h-8 w-full items-center justify-between border px-2 text-xs outline-none',
          open ? 'border-accent bg-base text-text-primary' : 'border-border-subtle bg-base text-text-primary',
        ].join(' ')}
      >
        <span>{activeLabel}</span>
        <ChevronDown
          size={12}
          className={['text-text-muted transition-transform', open ? 'rotate-180' : ''].join(' ')}
        />
      </button>
      {open ? (
        <ul className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 border border-border-subtle bg-surface shadow-lg">
          {BROADCAST_MODES.map((mode) => (
            <li key={mode.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(mode.value)
                  setOpen(false)
                }}
                className={[
                  'flex h-8 w-full items-center px-2 text-xs',
                  mode.value === value
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-primary hover:bg-elevated',
                ].join(' ')}
              >
                {mode.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Toggle({ enabled, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onToggle(!enabled)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center transition-colors',
        enabled ? 'bg-accent' : 'bg-elevated',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-3.5 w-3.5 transform transition-transform',
          enabled ? 'translate-x-[18px] bg-base' : 'translate-x-[3px] bg-text-muted',
        ].join(' ')}
      />
    </button>
  )
}

function SectionLabel({ children }) {
  return <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{children}</p>
}

function CardHeader({ label, title, icon, action }) {
  const Icon = icon
  return (
    <header className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={13} className="text-text-muted" /> : null}
        <div>
          <SectionLabel>{label}</SectionLabel>
          {title ? <h2 className="mt-0.5 text-sm text-text-primary">{title}</h2> : null}
        </div>
      </div>
      {action ?? null}
    </header>
  )
}

// ─── Profile Section ─────────────────────────────────────────────────────────

function ProfileSection({ userKey, session }) {
  const [displayName, setDisplayName] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [passwordMode, setPasswordMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase || !userKey) return

    void (async () => {
      const { data } = await supabase
        .from('app_users')
        .select('display_name')
        .eq('user_key', userKey)
        .maybeSingle()

      if (data?.display_name) {
        setDisplayName(data.display_name)
        setOriginalName(data.display_name)
      }
    })()
  }, [userKey])

  const saveName = async () => {
    if (!supabase || !userKey || !displayName.trim() || displayName === originalName) return

    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('app_users')
        .update({ display_name: displayName.trim() })
        .eq('user_key', userKey)
        .select('display_name')
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Update failed — check permissions.')
      setOriginalName(data.display_name)
      setDisplayName(data.display_name)
      setMessage('Name updated.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to update name.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const savePassword = async () => {
    if (!supabase || !newPassword || newPassword !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    if (newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.')
      return
    }

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setMessage('Password changed.')
      setPasswordMode(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to change password.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={revealTransition}
      className="border border-border-subtle bg-surface"
    >
      <CardHeader label="Account" icon={User} />

      <div className="space-y-3 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Display Name</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy}
              className="h-8 flex-1 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
            {displayName !== originalName && displayName.trim() ? (
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={busy}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-accent bg-accent/10 text-accent disabled:opacity-60"
              >
                <Check size={12} />
              </button>
            ) : null}
          </div>
        </label>

        {hasSupabaseCredentials && session?.user?.email ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Email</span>
            <input
              type="text"
              value={session.user.email}
              readOnly
              className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-muted outline-none"
            />
          </label>
        ) : null}

        {hasSupabaseCredentials && session ? (
          <div>
            {!passwordMode ? (
              <button
                type="button"
                onClick={() => setPasswordMode(true)}
                className="inline-flex h-8 items-center gap-1.5 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent"
              >
                <KeyRound size={11} /> Change Password
              </button>
            ) : (
              <div className="space-y-2 border border-border-subtle bg-base p-2">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    disabled={busy}
                    className="h-8 w-full border border-border-subtle bg-surface px-2 pr-8 text-xs text-text-primary outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent"
                  >
                    {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  disabled={busy}
                  className="h-8 w-full border border-border-subtle bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void savePassword()}
                    disabled={busy || !newPassword || newPassword !== confirmPassword}
                    className="inline-flex h-7 items-center gap-1 border border-accent bg-accent/10 px-2 text-[11px] text-accent disabled:opacity-60"
                  >
                    <Lock size={10} /> Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordMode(false)
                      setNewPassword('')
                      setConfirmPassword('')
                    }}
                    className="inline-flex h-7 items-center px-2 text-[11px] text-text-muted hover:text-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {message ? <p className="text-[11px] text-accent">{message}</p> : null}
      </div>
    </Motion.section>
  )
}

// ─── Targets Section ─────────────────────────────────────────────────────────

function TargetsSection({ userKey }) {
  const targetsState = useTargets()
  const queryClient = useQueryClient()
  const [selectedTier, setSelectedTier] = useState(1)
  const [days, setDays] = useState(14)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const targets = useMemo(() => targetsState.data ?? [], [targetsState.data])
  const tierTargets = useMemo(
    () =>
      targets.filter((t) => {
        const val = parseTargetValue(t.target_value)
        return t.target_type === 'tier' && Number(val.tier) === selectedTier
      }),
    [targets, selectedTier],
  )

  const refreshCaches = async () => {
    await queryClient.invalidateQueries({ queryKey: ['targets'] })
    await targetsState.refetch()
  }

  const startEdit = (target) => {
    const val = parseTargetValue(target.target_value)
    const remaining = target.deadline
      ? Math.max(1, Math.ceil((new Date(target.deadline) - new Date()) / 86400000))
      : 14
    setEditingId(target.id)
    setName(target.name || '')
    setDays(remaining)
    setSelectedTier(Number(val.tier) || 1)
    setPendingDeleteId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setName('')
    setDays(14)
  }

  const saveTarget = async () => {
    if (!supabase || !userKey) {
      setMessage(missingSupabaseMessage)
      return
    }

    setBusy(true)
    try {
      const deadline = toDateInputValue(addDays(new Date(), Number(days) || 14))
      const targetName = name.trim() || `Tier ${selectedTier} Target`

      if (editingId) {
        const { error } = await supabase
          .from('targets')
          .update({
            name: targetName,
            target_value: { tier: selectedTier },
            deadline,
          })
          .eq('id', editingId)
          .eq('user_key', userKey)
        if (error) throw error
        setMessage('Target updated.')
        setEditingId(null)
      } else {
        const { error } = await supabase.from('targets').insert({
          name: targetName,
          target_type: 'tier',
          target_value: { tier: selectedTier },
          deadline,
          user_key: userKey,
        })
        if (error) throw error
        setMessage('Target created.')
      }
      setName('')
      setDays(14)
      await refreshCaches()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save target.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const deleteTarget = async (targetId) => {
    if (!supabase || !userKey) return

    if (pendingDeleteId !== targetId) {
      setPendingDeleteId(targetId)
      return
    }

    setBusy(true)
    try {
      const { error } = await supabase.from('targets').delete().eq('id', targetId).eq('user_key', userKey)
      if (error) throw error
      setPendingDeleteId(null)
      if (editingId === targetId) cancelEdit()
      setMessage('Target deleted.')
      await refreshCaches()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to delete target.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...revealTransition, delay: 0.03 }}
      className="flex min-h-0 flex-col border border-border-subtle bg-surface"
    >
      <CardHeader label="Planning" title="Study Targets" />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Tier selector */}
        <div className="grid grid-cols-3 border border-border-subtle bg-base">
          {tierLabels.map((label, index) => {
            const tier = index + 1
            const selected = selectedTier === tier
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setSelectedTier(tier)}
                className={[
                  'h-8 border-r border-border-subtle text-xs last:border-r-0',
                  selected ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Create / Edit form */}
        <div className="mt-3 space-y-2">
          {editingId ? (
            <p className="text-[10px] uppercase tracking-[0.12em] text-accent">Editing target</p>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Name (optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Tier ${selectedTier} Target`}
              disabled={busy}
              className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Complete in (days)</span>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              min={1}
              disabled={busy}
              className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void saveTarget()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 border border-accent bg-accent/10 px-3 text-xs text-accent disabled:opacity-60"
            >
              {editingId ? (
                <><Check size={12} /> Save Target</>
              ) : (
                <><Plus size={12} /> Create Target</>
              )}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex h-8 items-center px-3 text-xs text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        {/* Existing targets for selected tier */}
        {tierTargets.length > 0 ? (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <SectionLabel>Active for Tier {selectedTier}</SectionLabel>
            <ul className="mt-2 divide-y divide-border-subtle">
              {tierTargets.map((target) => {
                const deleteArmed = pendingDeleteId === target.id
                const isEditing = editingId === target.id
                return (
                  <li key={target.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${isEditing ? 'text-accent' : 'text-text-primary'}`}>{target.name}</p>
                      <p className="font-mono text-[11px] text-text-muted">
                        {target.deadline ? formatDate(target.deadline) : 'No deadline'}
                        {target.completed_at ? ' · ✓ complete' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(target)}
                        className={[
                          'inline-flex h-7 shrink-0 items-center gap-1 border px-2 text-[11px]',
                          isEditing
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        <Edit3 size={11} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTarget(target.id)}
                        className={[
                          'inline-flex h-7 shrink-0 items-center gap-1 border px-2 text-[11px]',
                          deleteArmed
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        <Trash2 size={11} /> {deleteArmed ? 'Confirm' : 'Delete'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {message ? <p className="mt-2 text-[11px] text-accent">{message}</p> : null}
      </div>
    </Motion.section>
  )
}

// ─── Notifications Section ───────────────────────────────────────────────────

function NotificationsSection({ userKey }) {
  const { preferences, loading, toggle } = useNotificationPreferences(userKey)
  const { settings, update: updateSettings } = useUserSettings(userKey)

  if (loading) {
    return (
      <Motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...revealTransition, delay: 0.05 }}
        className="border border-border-subtle bg-surface p-3"
      >
        <SectionLabel>Notifications</SectionLabel>
        <p className="mt-2 text-xs text-text-muted">Loading preferences…</p>
      </Motion.section>
    )
  }

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...revealTransition, delay: 0.05 }}
      className="flex min-h-0 flex-col border border-border-subtle bg-surface"
    >
      <CardHeader label="Notifications" icon={Send} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-2">
          <div className="border-b border-border-subtle p-2.5 xl:border-b-0 xl:border-r">
            <SectionLabel>Sending</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {SEND_TYPES.map((item) => (
                <li key={item.type} className="flex min-h-7 items-center justify-between gap-3">
                  <span className="text-[11px] text-text-primary">{item.label}</span>
                  <Toggle
                    enabled={preferences[item.type]?.send_enabled ?? true}
                    onToggle={(on) => void toggle(item.type, 'send', on)}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-3 border-t border-border-subtle pt-2.5">
              <SectionLabel>Solve Broadcasts</SectionLabel>
              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <BroadcastModeSelect
                    value={settings.solve_broadcast_mode}
                    onChange={(val) => void updateSettings({ solve_broadcast_mode: val })}
                  />
                </div>
                {settings.solve_broadcast_mode === 'milestone' ? (
                  <label className="flex w-full flex-col gap-1 md:w-[148px]">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Every N</span>
                    <input
                      type="number"
                      value={settings.milestone_threshold}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 5)
                        void updateSettings({ milestone_threshold: val })
                      }}
                      min={1}
                      className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
                    />
                  </label>
                ) : null}
              </div>
            </div>
          </div>

          <div className="p-2.5">
            <SectionLabel>Receiving</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {RECEIVE_COLLAB_TYPES.map((item) => (
                <li key={item.type} className="flex min-h-7 items-center justify-between gap-3">
                  <span className="text-[11px] text-text-primary">{item.label}</span>
                  <Toggle
                    enabled={preferences[item.type]?.receive_enabled ?? true}
                    onToggle={(on) => void toggle(item.type, 'receive', on)}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-3 border-t border-border-subtle pt-2.5">
              <SectionLabel>System</SectionLabel>
              <ul className="mt-2 space-y-1.5">
                {RECEIVE_SYSTEM_TYPES.map((item) => (
                  <li key={item.type} className="flex min-h-7 items-center justify-between gap-3">
                    <span className="text-[11px] text-text-primary">{item.label}</span>
                    <Toggle
                      enabled={preferences[item.type]?.receive_enabled ?? true}
                      onToggle={(on) => void toggle(item.type, 'receive', on)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Motion.section>
  )
}

function DashboardSection({ userKey, activeTrackKey, onChangeTrack }) {
  const { settings, update: updateSettings } = useUserSettings(userKey)

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...revealTransition, delay: 0.04 }}
      className="border border-border-subtle bg-surface"
    >
      <CardHeader label="Dashboard" icon={User} />

      <div className="p-2">
        <div className="grid gap-2 md:grid-cols-2">
          <div className="border border-border-subtle bg-base/60 p-2">
            <SectionLabel>Preferred mode</SectionLabel>
            <div className="mt-1.5 inline-flex w-full items-center gap-0.5 border border-border-subtle bg-base p-0.5">
              {PREFERRED_MODE_OPTIONS.map((mode) => (
                <button
                  key={`preferred-mode-${mode.value}`}
                  type="button"
                  onClick={() => void onChangeTrack(mode.value)}
                  className={[
                    'inline-flex h-7 min-w-0 flex-1 items-center justify-center border px-2 font-mono text-[10px] transition-colors',
                    activeTrackKey === mode.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-transparent text-text-muted hover:border-border-subtle hover:text-text-primary',
                  ].join(' ')}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-border-subtle bg-base/60 p-2">
            <SectionLabel>Comparison</SectionLabel>
            <div className="mt-1.5 inline-flex w-full items-center gap-0.5 border border-border-subtle bg-base p-0.5">
              {DASHBOARD_COMPARISON_MODES.map((mode) => (
                <button
                  key={`dashboard-comparison-${mode.value}`}
                  type="button"
                  onClick={() => void updateSettings({ dashboard_comparison_mode: mode.value })}
                  className={[
                    'inline-flex h-7 min-w-0 flex-1 items-center justify-center border px-2 font-mono text-[10px] transition-colors',
                    settings.dashboard_comparison_mode === mode.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-transparent text-text-muted hover:border-border-subtle hover:text-text-primary',
                  ].join(' ')}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Motion.section>
  )
}

function AISection({ userKey }) {
  const { settings, update: updateSettings } = useUserSettings(userKey)
  const [credentials, setCredentials] = useState([])
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState('My Gemini key')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!userKey || !isAssistantConfigured()) {
      setCredentials([])
      return
    }

    void (async () => {
      try {
        const data = await assistantRequest('/assistant/credentials')
        setCredentials(data)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Failed to load AI settings.')
      }
    })()
  }, [userKey])

  const activeCredential = credentials.find((item) => item.is_active) ?? null

  const saveCredential = async () => {
    if (!apiKey.trim()) {
      setMessage('Gemini API key is required.')
      return
    }

    setBusy(true)
    try {
      const data = await assistantRequest('/assistant/credentials', {
        method: 'POST',
        body: JSON.stringify({
          api_key: apiKey.trim(),
          label: label.trim() || 'My Gemini key',
        }),
      })
      setCredentials([data])
      setApiKey('')
      setMessage('Gemini API key saved and validated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save Gemini API key.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const removeCredential = async () => {
    if (!activeCredential) {
      return
    }

    setBusy(true)
    try {
      await assistantRequest(`/assistant/credentials/${activeCredential.id}`, {
        method: 'DELETE',
      })
      setCredentials([])
      if (settings.preferred_ai_provider_mode === 'user_key') {
        await updateSettings({ preferred_ai_provider_mode: 'platform' })
      }
      setMessage('Gemini API key removed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to remove Gemini API key.')
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  return (
    <Motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...revealTransition, delay: 0.045 }}
      className="border border-border-subtle bg-surface"
    >
      <CardHeader label="AI Assistant" icon={KeyRound} />

      <div className="space-y-2.5 p-2.5">
        <div className="border border-border-subtle bg-base/60 p-2">
          <SectionLabel>Provider</SectionLabel>
          <div className="mt-1.5 inline-flex w-full items-center gap-0.5 border border-border-subtle bg-base p-0.5">
            {[
              { value: 'platform', label: 'Practicer AI' },
              { value: 'user_key', label: 'Your Gemini Key' },
            ].map((mode) => (
              <button
                key={`ai-provider-${mode.value}`}
                type="button"
                disabled={mode.value === 'user_key' && !activeCredential}
                onClick={() => void updateSettings({ preferred_ai_provider_mode: mode.value })}
                className={[
                  'inline-flex h-7 min-w-0 flex-1 items-center justify-center border px-2 font-mono text-[10px] transition-colors disabled:opacity-40',
                  settings.preferred_ai_provider_mode === mode.value
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-transparent text-text-muted hover:border-border-subtle hover:text-text-primary',
                ].join(' ')}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {!isAssistantConfigured() ? (
          <div className="border border-border-subtle bg-base px-2.5 py-2 text-[11px] text-text-muted">
            Runner service is not configured. Set `VITE_RUNNER_API_URL` to enable the AI assistant.
          </div>
        ) : null}

        <div className="border border-border-subtle bg-base/60 p-2">
          <SectionLabel>Bring Your Own Key</SectionLabel>
          {activeCredential ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 border border-border-subtle bg-base px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-text-primary">{activeCredential.label}</p>
                <p className="mt-1 font-mono text-[11px] text-text-muted">
                  ...{activeCredential.masked_suffix} · {activeCredential.validated_at ? 'Validated' : 'Saved'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void removeCredential()}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-60"
              >
                <Trash2 size={11} />
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-1.5 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Label</span>
                <input
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Gemini API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="AIza..."
                  className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={() => void saveCredential()}
                disabled={busy || !isAssistantConfigured()}
                className="inline-flex h-8 items-center justify-center gap-1 border border-accent bg-accent/10 px-3 text-xs text-accent disabled:opacity-60"
              >
                {busy ? <><Send size={12} /> Validating…</> : <><Plus size={12} /> Save Key</>}
              </button>
            </div>
          )}
        </div>

        {message ? <p className="text-[11px] text-accent">{message}</p> : null}
      </div>
    </Motion.section>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { userKey, session, activeTrackKey, setActiveTrackKey } = useCurrentUser()

  return (
    <section className="h-[100dvh] w-full overflow-hidden p-3 md:p-4">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <Motion.header
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={revealTransition}
          className="border border-border-subtle bg-surface px-3 py-2"
        >
          <SectionLabel>Settings</SectionLabel>
          <p className="mt-1 text-sm text-text-primary">Profile, planning, notifications, and assistant preferences</p>
        </Motion.header>

        <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[0.35fr_0.65fr]">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            <ProfileSection userKey={userKey} session={session} />
            <TargetsSection userKey={userKey} />
          </div>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
            <DashboardSection
              userKey={userKey}
              activeTrackKey={activeTrackKey}
              onChangeTrack={setActiveTrackKey}
            />

            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="grid min-h-full content-start gap-3">
                <AISection userKey={userKey} />
                <NotificationsSection userKey={userKey} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
