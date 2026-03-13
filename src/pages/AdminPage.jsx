import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion as Motion } from 'framer-motion'
import {
  BarChart3,
  Check,
  Copy,
  KeyRound,
  List,
  Mail,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCurrentUser } from '../context/user-store'
import { useProblems } from '../hooks/useProblems'
import {
  difficultySortValue,
  flattenProblems,
  fuzzyIncludes,
  problemIdentityKey,
  problemUrl,
} from '../lib/problem-utils'
import { supabase } from '../lib/supabase'
import { ProblemModal } from '../components/problems/ProblemModal'
import { CustomSelect } from '../components/ui/CustomSelect'
import { sourceLabelForProblem, TRACK_OPTIONS } from '../lib/catalog-admin'
import { isRunnerConfigured, runnerRequest } from '../lib/assistant-client'

const TABS = [
  { id: 'problems', label: 'Problems', Icon: List },
  { id: 'moderation', label: 'Moderation', Icon: MessageSquare },
  { id: 'announcements', label: 'Announce', Icon: Megaphone },
  { id: 'system', label: 'System', Icon: Server },
]
const DIFF_COLORS = { Easy: '#22c55e', Medium: '#f59e0b', Hard: '#ef4444' }

/* ── Tiny helpers ────────────────────────────────────────────── */
function Label({ children }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{children}</p>
}
function StatBox({ label, value, accent }) {
  return (
    <div className={`border px-3 py-2 ${accent ? 'border-accent/30 bg-accent/5' : 'border-border-subtle bg-base'}`}>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`font-mono text-sm ${accent ? 'text-accent' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}
function Badge({ children, color = 'accent' }) {
  const c = color === 'accent' ? 'border-accent/30 bg-accent/5 text-accent' : 'border-text-muted/20 bg-text-muted/5 text-text-muted'
  return <span className={`inline-flex items-center border px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${c}`}>{children}</span>
}

function sortPhaseChoices(rows) {
  const unique = new Map()
  for (const row of rows) {
    if (!row.phase) continue
    unique.set(Number(row.phase), row.phaseName || `Phase ${row.phase}`)
  }
  return Array.from(unique.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([phase, name]) => ({ phase, name }))
}

function normalizeAdminUserKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

function deriveAdminUserKey({ displayName, email }) {
  const fromName = normalizeAdminUserKey(displayName)
  if (fromName) {
    return fromName
  }

  return normalizeAdminUserKey(String(email || '').split('@')[0])
}

function buildGeneratedPassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const values = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(length)) : null
  let password = ''
  for (let index = 0; index < length; index += 1) {
    const seed = values ? values[index] : Math.floor(Math.random() * alphabet.length * 1000)
    password += alphabet[seed % alphabet.length]
  }
  return password
}

async function copyText(value) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable in this browser.')
  }

  await navigator.clipboard.writeText(String(value || ''))
}

/* ── Mini bar chart ──────────────────────────────────────────── */
function MiniBar({ data, colors = {} }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="flex h-full items-end gap-2 px-1">
      {data.map((d) => {
        // We set a minimum height for visibility, and calculate percentage for the bar
        const pct = Math.max((d.value / max) * 100, d.value === 0 ? 0 : 5)
        return (
          <div key={d.label} className="flex min-h-0 flex-1 flex-col-reverse items-center justify-start gap-1 h-full pt-2">
            <span className="shrink-0 text-[8px] text-text-muted truncate max-w-[150%]">{d.label}</span>
            <div className="flex h-full w-full max-w-[24px] flex-col justify-end">
              <div 
                className={`w-full transition-all duration-300 relative rounded-t-[2px] ${d.value === 0 ? 'bg-surface-hover' : ''}`} 
                style={d.value > 0 ? { 
                  height: `${pct}%`, 
                  backgroundColor: colors[d.label] || 'var(--color-accent)'
                } : { height: '5px' }} 
              />
            </div>
            {d.value > 0 ? <span className="shrink-0 text-[8px] font-mono text-text-muted">{d.value}</span> : <span className="shrink-0 text-[8px] opacity-0 text-transparent">0</span>}
          </div>
        )
      })}
    </div>
  )
}

/* ── Thin progress bar ───────────────────────────────────────── */
function ThinBar({ value, max, label, color = 'var(--color-accent)' }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 truncate text-[10px] text-text-muted">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 bg-border-subtle/30"><div className="h-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} /></div>
      <span className="w-10 text-right font-mono text-[9px] text-text-muted">{value}/{max}</span>
    </div>
  )
}

/* ── Test Case Modal ─────────────────────────────────────────── */
function TestCaseModal({ lc, open, onClose }) {
  const [testCases, setTestCases] = useState([])
  const [loading, setLoading] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ input_text: '', expected_output: '', notes: '' })

  const fetch_ = useCallback(async () => {
    if (!supabase || !lc) return
    setLoading(true)
    try { const { data } = await supabase.from('problem_test_cases').select('*').eq('problem_lc', lc).order('sort_order'); setTestCases(data ?? []) }
    catch { setTestCases([]) } finally { setLoading(false) }
  }, [lc])
  useEffect(() => { if (open) { void fetch_(); setAdding(false); setDeleteId(null) } }, [open, fetch_])

  const toggle = async (tc) => { if (!supabase) return; await supabase.from('problem_test_cases').update({ is_active: !tc.is_active }).eq('id', tc.id); setTestCases((c) => c.map((t) => t.id === tc.id ? { ...t, is_active: !t.is_active } : t)) }
  const del = async (id) => { if (!supabase) return; if (deleteId !== id) { setDeleteId(id); return }; await supabase.from('problem_test_cases').delete().eq('id', id); setTestCases((c) => c.filter((t) => t.id !== id)); setDeleteId(null) }
  const add = async () => {
    if (!supabase || !form.input_text.trim()) return; setSaving(true)
    try {
      const order = testCases.length > 0 ? Math.max(...testCases.map((t) => t.sort_order ?? 0)) + 1 : 1
      const { data } = await supabase.from('problem_test_cases').insert({ problem_lc: lc, input_text: form.input_text.trim(), expected_output: form.expected_output.trim(), notes: form.notes.trim() || null, sort_order: order, is_active: true }).select().single()
      if (data) setTestCases((c) => [...c, data]); setForm({ input_text: '', expected_output: '', notes: '' }); setAdding(false)
    } catch { /* */ } finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="flex max-h-[75vh] w-full max-w-lg flex-col border border-border-subtle bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div><Label>Test Cases</Label><p className="mt-0.5 text-sm font-medium text-text-primary">LC #{lc}</p></div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? <p className="py-6 text-center text-xs text-text-muted">Loading…</p> : null}
          {!loading && testCases.length === 0 && !adding ? <p className="py-6 text-center text-xs text-text-muted">No test cases.</p> : null}
          {testCases.map((tc, i) => (
            <div key={tc.id} className={`border border-border-subtle p-3 text-xs ${tc.is_active ? '' : 'opacity-40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold text-text-muted">#{i + 1}</p>
                  <div className="mt-1 space-y-1">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Input</p>
                      <div className="mt-0.5 overflow-x-auto border border-border-subtle bg-base">
                        <pre className="min-w-max p-2 font-mono text-[11px] leading-5 text-text-primary">{String(tc.input_text ?? '')}</pre>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.08em] text-text-muted">Expected</p>
                      <div className="mt-0.5 overflow-x-auto border border-border-subtle bg-base">
                        <pre className="min-w-max p-2 font-mono text-[11px] leading-5 text-text-muted">{String(tc.expected_output ?? '')}</pre>
                      </div>
                    </div>
                    {tc.notes ? <p className="text-text-muted">Note: {tc.notes}</p> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1"><button type="button" onClick={() => void toggle(tc)} className="h-6 border border-border-subtle px-2 text-[10px] text-text-muted hover:text-accent">{tc.is_active ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => void del(tc.id)} className={`h-6 border px-2 text-[10px] ${deleteId === tc.id ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-border-subtle text-text-muted hover:text-red-400'}`}>{deleteId === tc.id ? 'Sure?' : 'Delete'}</button></div>
              </div>
            </div>
          ))}
          {adding ? (
            <div className="space-y-2 border border-accent/30 bg-accent/5 p-3"><Label>New Test Case</Label>
              <textarea value={form.input_text} onChange={(e) => setForm((v) => ({ ...v, input_text: e.target.value }))} placeholder="Input…" rows={2} className="w-full border border-border-subtle bg-base px-2 py-1 font-mono text-xs text-text-primary outline-none focus:border-accent" />
              <textarea value={form.expected_output} onChange={(e) => setForm((v) => ({ ...v, expected_output: e.target.value }))} placeholder="Expected output…" rows={2} className="w-full border border-border-subtle bg-base px-2 py-1 font-mono text-xs text-text-primary outline-none focus:border-accent" />
              <input type="text" value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} placeholder="Notes (optional)" className="h-7 w-full border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent" />
              <div className="flex gap-2"><button type="button" onClick={() => void add()} disabled={saving || !form.input_text.trim()} className="h-7 border border-accent bg-accent/10 px-3 text-[11px] text-accent disabled:opacity-50"><Check size={11} className="mr-1 inline" />Save</button><button type="button" onClick={() => setAdding(false)} className="h-7 px-2 text-[11px] text-text-muted">Cancel</button></div>
            </div>
          ) : null}
        </div>
        <div className="border-t border-border-subtle px-4 py-2.5"><button type="button" onClick={() => setAdding(true)} disabled={adding} className="h-7 border border-accent bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"><Plus size={11} className="mr-1 inline" />Add</button></div>
      </div>
    </div>
  )
}

/* ── PROBLEMS TAB ────────────────────────────────────────────── */
function ProblemsTab() {
  const problemsState = useProblems()
  const [query, setQuery] = useState('')
  const [trackFilter, setTrackFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [diffFilter, setDiffFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editingProblem, setEditingProblem] = useState(null)
  const [savingProblem, setSavingProblem] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [tcModalLc, setTcModalLc] = useState(null)

  const rows = useMemo(() => flattenProblems(problemsState.data ?? []), [problemsState.data])
  const phaseOptions = useMemo(() => { const m = new Map(); for (const r of rows) m.set(String(r.phase), r.phaseName || `Phase ${r.phase}`); return Array.from(m.entries()).sort((a, b) => Number(a[0]) - Number(b[0])) }, [rows])
  const phaseChoices = useMemo(() => sortPhaseChoices(rows), [rows])
  const diffOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.difficulty))).sort((a, b) => difficultySortValue(a) - difficultySortValue(b)), [rows])

  const hasQuery = query.trim().length >= 2
  const results = useMemo(() => {
    let f = rows
    if (hasQuery) {
      f = f.filter((r) =>
        fuzzyIncludes(
          query,
          [r.title, r.problemKey, String(r.lc), r.phaseName, r.type, r.difficulty, r.sourcePlatform, r.sourceProblemId]
            .filter(Boolean)
            .join(' '),
        ),
      )
    }
    if (trackFilter !== 'all') f = f.filter((r) => String(r.track || r.track_key || 'dsa') === trackFilter)
    if (tierFilter !== 'all') f = f.filter((r) => String(r.tier) === tierFilter)
    if (phaseFilter !== 'all') f = f.filter((r) => String(r.phase) === phaseFilter)
    if (diffFilter !== 'all') f = f.filter((r) => r.difficulty === diffFilter)
    return f
  }, [rows, query, hasQuery, trackFilter, tierFilter, phaseFilter, diffFilter])
  const showResults = hasQuery || trackFilter !== 'all' || tierFilter !== 'all' || phaseFilter !== 'all' || diffFilter !== 'all'

  const openCreate = () => { setModalMode('create'); setEditingProblem(null); setSaveError(''); setModalOpen(true) }
  const openEdit = (pid) => { const p = (problemsState.data ?? []).find((r) => r.id === pid); if (!p) return; setModalMode('edit'); setEditingProblem(p); setSaveError(''); setModalOpen(true) }
  const handleSave = async (payload) => {
    if (!supabase) return; setSavingProblem(true); setSaveError('')
    try {
      const { trackKey, problem, content, seedTestCases, companionRelation, sqlSpec, sqlFixtures, sqlReferenceSolution } = payload
      const moduleKey = trackKey === 'sql' ? `sql-phase-${problem.module_number}` : `phase-${problem.module_number}`

      const { data: moduleRow, error: moduleError } = await supabase
        .from('study_modules')
        .upsert(
          {
            track_key: problem.track_key,
            module_key: moduleKey,
            module_number: problem.module_number,
            name: problem.module_name,
            sort_order: problem.module_number,
            is_active: true,
          },
          { onConflict: 'track_key,module_key' },
        )
        .select('id')
        .single()

      if (moduleError) throw moduleError

      const canonicalProblemPayload = {
        problem_key: problem.problem_key,
        problem_lc: trackKey === 'dsa' ? problem.problem_lc : null,
        track_key: problem.track_key,
        module_id: moduleRow.id,
        source_type: problem.source_type || (trackKey === 'dsa' ? 'neetcode' : 'core'),
        source_platform: problem.source_platform,
        source_problem_id: problem.source_problem_id,
        title: problem.title,
        slug: problem.slug,
        difficulty: problem.difficulty,
        tier: problem.tier,
        phase_order: problem.phase_order,
        study_order: problem.study_order ?? problem.problem_lc ?? 1,
        curation_source: trackKey === 'sql' ? 'sql_curriculum' : 'core',
        category: problem.category,
        companies: problem.companies,
        leetcode_url: problem.leetcode_url,
        neetcode_url: problem.neetcode_url,
        canonical_source_url: problem.canonical_source_url,
        source_url: problem.source_url,
        faang_verification: problem.faang_verification,
        inclusion_rationale: problem.inclusion_rationale,
        is_active: true,
      }

      const legacyDsaProblemPayload = {
        problem_lc: problem.problem_lc,
        track_key: problem.track_key,
        module_id: moduleRow.id,
        source_type: problem.source_type || 'neetcode',
        title: problem.title,
        slug: problem.slug,
        difficulty: problem.difficulty,
        tier: problem.tier,
        phase_order: problem.phase_order,
        study_order: problem.study_order ?? problem.problem_lc,
        curation_source: 'core',
        category: problem.category,
        companies: problem.companies,
        leetcode_url: problem.leetcode_url,
        neetcode_url: problem.neetcode_url,
        is_active: true,
      }

      let savedProblem = null

      try {
        if (modalMode === 'edit' && editingProblem) {
          const { data, error } = await supabase
            .from('study_problems')
            .update(canonicalProblemPayload)
            .eq('id', editingProblem.id)
            .select('id,problem_lc,problem_key')
            .single()
          if (error) throw error
          savedProblem = data
        } else {
          const { data, error } = await supabase
            .from('study_problems')
            .insert(canonicalProblemPayload)
            .select('id,problem_lc,problem_key')
            .single()
          if (error) throw error
          savedProblem = data
        }
      } catch (problemError) {
        const problemMessage = problemError instanceof Error ? problemError.message : String(problemError || '')
        const isLegacyDsaFallback =
          trackKey === 'dsa' &&
          /(problem_key|source_platform|source_problem_id|canonical_source_url|source_url|faang_verification|inclusion_rationale)/i.test(problemMessage)

        if (!isLegacyDsaFallback) {
          throw problemError
        }

        if (modalMode === 'edit' && editingProblem) {
          const { data, error } = await supabase
            .from('study_problems')
            .update(legacyDsaProblemPayload)
            .eq('id', editingProblem.id)
            .select('id,problem_lc')
            .single()
          if (error) throw error
          savedProblem = data
        } else {
          const { data, error } = await supabase
            .from('study_problems')
            .insert(legacyDsaProblemPayload)
            .select('id,problem_lc')
            .single()
          if (error) throw error
          savedProblem = data
        }
      }

      const savedProblemKey = savedProblem.problem_key || problem.problem_key || null

      try {
        const contentPayload = {
          ...content,
          problem_key: savedProblemKey,
          problem_lc: savedProblem.problem_lc ?? null,
          title: problem.title,
          difficulty: problem.difficulty,
        }
        if (savedProblemKey) {
          let existingContent = null
          const lookupContent = async (column, value) => {
            if (value === null || value === undefined || value === '') {
              return null
            }

            const { data, error } = await supabase
              .from('problem_content')
              .select('content_id,problem_key,problem_lc')
              .eq(column, value)
              .maybeSingle()

            if (error) throw error
            return data ?? null
          }

          const originalProblemKey = modalMode === 'edit' ? editingProblem?.problem_key || null : null
          const originalProblemLc = modalMode === 'edit' ? editingProblem?.problem_lc ?? editingProblem?.lc ?? null : null

          existingContent =
            (await lookupContent('problem_key', originalProblemKey)) ||
            (await lookupContent('problem_lc', originalProblemLc)) ||
            (await lookupContent('problem_key', savedProblemKey)) ||
            (await lookupContent('problem_lc', savedProblem.problem_lc ?? null))

          if (existingContent?.content_id) {
            const { error: updateContentError } = await supabase
              .from('problem_content')
              .update(contentPayload)
              .eq('content_id', existingContent.content_id)

            if (updateContentError) throw updateContentError
          } else {
            const { error: insertContentError } = await supabase
              .from('problem_content')
              .insert(contentPayload)

            if (insertContentError) throw insertContentError
          }
        } else {
          const { error: contentError } = await supabase
            .from('problem_content')
            .upsert(contentPayload, { onConflict: 'problem_lc' })

          if (contentError) throw contentError
        }
      } catch (contentError) {
        const contentMessage = contentError instanceof Error ? contentError.message : String(contentError || '')
        const isLegacyDsaFallback =
          trackKey === 'dsa' &&
          /(problem_key|statement_raw|statement_clean|constraints_text|starter_snippet|editor_language|runtime_kind)/i.test(contentMessage)

        if (!isLegacyDsaFallback) {
          throw contentError
        }

        const legacyContentPayload = {
          problem_lc: savedProblem.problem_lc,
          title: problem.title,
          difficulty: problem.difficulty,
          tags: content.tags,
          problem_description: content.problem_description,
          starter_code: content.starter_code,
          entry_point: content.entry_point,
          input_output: content.input_output,
          source: content.source,
        }

        const { error } = await supabase.from('problem_content').upsert(legacyContentPayload, { onConflict: 'problem_lc' })
        if (error) throw error
      }

      if (trackKey === 'dsa') {
        const persistLegacyCompanionRelations = async () => {
          const { error: deleteFromError } = await supabase
            .from('problem_relationships')
            .delete()
            .eq('from_problem_lc', savedProblem.problem_lc)
            .eq('relationship_type', 'companion')
          if (deleteFromError) throw deleteFromError

          const { error: deleteToError } = await supabase
            .from('problem_relationships')
            .delete()
            .eq('to_problem_lc', savedProblem.problem_lc)
            .eq('relationship_type', 'companion')
          if (deleteToError) throw deleteToError

          if (companionRelation?.to_problem_lc) {
            if (companionRelation.to_problem_lc === savedProblem.problem_lc) {
              throw new Error('Companion LC must be different from the current problem.')
            }

            const { data: linkedProblem, error: linkedProblemError } = await supabase
              .from('study_problems')
              .select('problem_lc')
              .eq('problem_lc', companionRelation.to_problem_lc)
              .maybeSingle()

            if (linkedProblemError) throw linkedProblemError
            if (!linkedProblem) {
              throw new Error('Companion LC must reference an existing problem.')
            }

            const relationRows = [
              {
                from_problem_lc: savedProblem.problem_lc,
                to_problem_lc: companionRelation.to_problem_lc,
                relationship_type: 'companion',
                label: companionRelation.label,
                notes: companionRelation.notes,
                sort_order: 1,
              },
              {
                from_problem_lc: companionRelation.to_problem_lc,
                to_problem_lc: savedProblem.problem_lc,
                relationship_type: 'companion',
                label: companionRelation.label,
                notes: companionRelation.notes,
                sort_order: 1,
              },
            ]

            const { error: relationError } = await supabase
              .from('problem_relationships')
              .upsert(relationRows, { onConflict: 'from_problem_lc,to_problem_lc,relationship_type' })

            if (relationError) throw relationError
          }
        }

        const persistCanonicalCompanionRelations = async () => {
          if (!savedProblemKey) {
            throw new Error('Canonical problem key missing for companion write.')
          }

          const { error: deleteFromError } = await supabase
            .from('problem_relationships')
            .delete()
            .eq('from_problem_key', savedProblemKey)
            .eq('relationship_type', 'companion')
          if (deleteFromError) throw deleteFromError

          const { error: deleteToError } = await supabase
            .from('problem_relationships')
            .delete()
            .eq('to_problem_key', savedProblemKey)
            .eq('relationship_type', 'companion')
          if (deleteToError) throw deleteToError

          if (companionRelation?.to_problem_lc) {
            const { data: linkedProblem, error: linkedProblemError } = await supabase
              .from('study_problems')
              .select('problem_lc,problem_key')
              .eq('problem_lc', companionRelation.to_problem_lc)
              .maybeSingle()

            if (linkedProblemError) throw linkedProblemError
            if (!linkedProblem?.problem_key) {
              throw new Error('Companion LC must reference an existing canonical problem.')
            }
            if (linkedProblem.problem_key === savedProblemKey) {
              throw new Error('Companion problem must be different from the current problem.')
            }

            const relationRows = [
              {
                from_problem_key: savedProblemKey,
                to_problem_key: linkedProblem.problem_key,
                relationship_type: 'companion',
                label: companionRelation.label,
                notes: companionRelation.notes,
                sort_order: 1,
              },
              {
                from_problem_key: linkedProblem.problem_key,
                to_problem_key: savedProblemKey,
                relationship_type: 'companion',
                label: companionRelation.label,
                notes: companionRelation.notes,
                sort_order: 1,
              },
            ]

            const { error: relationError } = await supabase
              .from('problem_relationships')
              .upsert(relationRows, { onConflict: 'from_problem_key,to_problem_key,relationship_type' })

            if (relationError) throw relationError
          }
        }

        try {
          await persistCanonicalCompanionRelations()
        } catch (relationError) {
          const relationMessage = relationError instanceof Error ? relationError.message : String(relationError || '')
          const isLegacyFallback =
            !savedProblemKey ||
            /(from_problem_key|to_problem_key|ux_problem_relationships_problem_key_type|column .*problem_key)/i.test(relationMessage)

          if (!isLegacyFallback) {
            throw relationError
          }

          await persistLegacyCompanionRelations()
        }

        if (modalMode === 'create' && Array.isArray(seedTestCases) && seedTestCases.length > 0) {
          const testRows = seedTestCases.map((testCase, index) => ({
            problem_lc: savedProblem.problem_lc,
            sort_order: index + 1,
            input_text: testCase.input_text,
            expected_output: testCase.expected_output || null,
            notes: testCase.notes || null,
            source: 'manual',
            is_active: true,
          }))

          const { error: testInsertError } = await supabase.from('problem_test_cases').insert(testRows)
          if (testInsertError) throw testInsertError
        }
      } else {
        const { error: specError } = await supabase
          .from('sql_problem_specs')
          .upsert({ ...sqlSpec, problem_key: savedProblemKey }, { onConflict: 'problem_key' })
        if (specError) throw specError

        const { error: deleteFixturesError } = await supabase
          .from('sql_problem_fixtures')
          .delete()
          .eq('problem_key', savedProblemKey)
        if (deleteFixturesError) throw deleteFixturesError

        if (Array.isArray(sqlFixtures) && sqlFixtures.length > 0) {
          const { error: fixtureError } = await supabase
            .from('sql_problem_fixtures')
            .insert(sqlFixtures.map((fixture) => ({ ...fixture, problem_key: savedProblemKey })))
          if (fixtureError) throw fixtureError
        }

        const hasReferenceSql =
          sqlReferenceSolution &&
          (sqlReferenceSolution.reference_sql_original || sqlReferenceSolution.reference_sql_runtime)

        if (hasReferenceSql) {
          const { error: referenceError } = await supabase
            .from('sql_problem_reference_solutions')
            .upsert({ ...sqlReferenceSolution, problem_key: savedProblemKey }, { onConflict: 'problem_key' })
          if (referenceError) throw referenceError
        }
      }

      setModalOpen(false); await problemsState.refetch()
    } catch (e) {
      const rawMessage = e instanceof Error ? e.message : 'Failed.'
      const nextMessage =
        /problem_content/i.test(rawMessage) && /(row level security|permission denied|403|new row violates)/i.test(rawMessage)
          ? 'Admin writes to problem content are blocked by RLS. Apply supabase/migrations/202603110002_problem_content_admin_manage.sql and ensure your app_users row has is_admin = true.'
          :
        /sql_problem_specs|sql_problem_fixtures|problem_key|source_platform|source_problem_id|canonical_source_url/i.test(rawMessage)
          ? 'The cross-track SQL schema is not live yet. Finish coding, deploy the SQL runner, then run the pending migration before using SQL admin create/edit.'
          : rawMessage
      setSaveError(nextMessage)
    } finally { setSavingProblem(false) }
  }
  const deleteProblem = async (id) => { if (!supabase) return; if (deleteConfirmId !== id) { setDeleteConfirmId(id); return }; await supabase.from('study_problems').delete().eq('id', id); setDeleteConfirmId(null); await problemsState.refetch() }

  const trackOpts = [{ value: 'all', label: 'All Tracks' }, ...TRACK_OPTIONS]
  const tierOpts = [{ value: 'all', label: 'All Tiers' }, { value: '1', label: 'Tier 1' }, { value: '2', label: 'Tier 2' }, { value: '3', label: 'Tier 3' }]
  const phaseOpts = [{ value: 'all', label: 'All Phases' }, ...phaseOptions.map(([v, l]) => ({ value: v, label: `${v}. ${l}` }))]
  const diffOpts = [{ value: 'all', label: 'All Diff' }, ...diffOptions.map((d) => ({ value: d, label: d }))]

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-text-primary">Problems</h2><p className="text-[11px] text-text-muted">{rows.length} total</p></div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void problemsState.refetch()} className="h-7 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"><RefreshCcw size={11} className="mr-1 inline" />Refresh</button>
          <button type="button" onClick={openCreate} className="h-7 border border-accent bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20"><Plus size={11} className="mr-1 inline" />Add</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[160px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={13} /><input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setDeleteConfirmId(null) }} placeholder="Search by title, source, key…" className="h-8 w-full border border-border-subtle bg-base pl-8 pr-2 text-xs text-text-primary outline-none focus:border-accent" /></label>
        <CustomSelect value={trackFilter} onChange={setTrackFilter} options={trackOpts} />
        <CustomSelect value={tierFilter} onChange={setTierFilter} options={tierOpts} />
        <CustomSelect value={phaseFilter} onChange={setPhaseFilter} options={phaseOpts} />
        <CustomSelect value={diffFilter} onChange={setDiffFilter} options={diffOpts} />
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {!showResults ? (
          <div className="flex h-full flex-col items-center justify-center text-text-muted"><Search size={28} className="mb-2 opacity-30" /><p className="text-xs">Search or filter to find problems</p></div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">No results.</p>
        ) : (
          <div className="space-y-1">{results.map((row) => (
            <div key={`${row.rowId}-${row.type}`} className="flex items-center justify-between gap-3 border border-border-subtle bg-surface px-3 py-2 hover:border-accent/30">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={problemUrl(row.problemKey || row.lc, row.title)} className="truncate text-sm text-text-primary hover:text-accent">{row.title}</Link>
                  <Badge color={row.track === 'sql' ? 'accent' : 'muted'}>{row.track || 'dsa'}</Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-text-muted">{sourceLabelForProblem(row)} · {row.difficulty} · {row.phase}. {row.phaseName} · T{row.tier}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => openEdit(row.rowId)} className="h-6 w-6 border border-border-subtle text-text-muted hover:border-accent hover:text-accent grid place-items-center"><Pencil size={11} /></button>
                {row.track !== 'sql' && row.lc ? <button type="button" onClick={() => setTcModalLc(row.lc)} className="h-6 border border-border-subtle px-1.5 text-[10px] text-text-muted hover:border-accent hover:text-accent">TC</button> : null}
                <button type="button" onClick={() => void deleteProblem(row.rowId)} className={`h-6 w-6 border grid place-items-center ${deleteConfirmId === row.rowId ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-border-subtle text-text-muted hover:border-red-500/40 hover:text-red-400'}`}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}</div>
        )}
      </div>
      <ProblemModal key={`${modalMode}-${editingProblem?.id ?? 'new'}-${modalOpen}`} open={modalOpen} mode={modalMode} problem={editingProblem} phaseOptions={phaseChoices} saving={savingProblem} onClose={() => { if (!savingProblem) setModalOpen(false) }} onSave={handleSave} />
      <TestCaseModal lc={tcModalLc} open={tcModalLc !== null} onClose={() => setTcModalLc(null)} />
      {saveError ? <p className="mt-1 text-[11px] text-red-400">{saveError}</p> : null}
    </div>
  )
}

/* ── MODERATION TAB ──────────────────────────────────────────── */
function ModerationTab() {
  const [subTab, setSubTab] = useState('comments')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [deleteId, setDeleteId] = useState(null)

  const fetch_ = useCallback(async () => { if (!supabase) return; setLoading(true); try { const table = subTab === 'comments' ? 'problem_comments' : subTab === 'solutions' ? 'shared_solutions' : 'shared_notes'; const { data } = await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(200); setItems(data ?? []) } catch { setItems([]) } finally { setLoading(false) } }, [subTab])
  useEffect(() => { void fetch_() }, [fetch_])

  const del = async (id) => { if (!supabase) return; if (deleteId !== id) { setDeleteId(id); return }; const table = subTab === 'comments' ? 'problem_comments' : subTab === 'solutions' ? 'shared_solutions' : 'shared_notes'; await supabase.from(table).delete().eq('id', id); setItems((c) => c.filter((i) => i.id !== id)); setDeleteId(null) }

  // Extract plain text from Tiptap JSON safely
  const extractText = (content) => {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (content.type === 'text') return content.text || ''
    if (Array.isArray(content)) return content.map(extractText).join(' ')
    if (content.content) return extractText(content.content)
    return ''
  }

  const text = (item) => { 
    const r = item.content || item.title || item.code || ''
    if (typeof r === 'object') {
      const extracted = extractText(r).trim()
      return extracted ? extracted.substring(0, 250) : JSON.stringify(r).substring(0, 250)
    }
    return String(r).substring(0, 250) 
  }

  const filtered = useMemo(() => { if (!searchQ.trim()) return items; return items.filter((i) => { const t = [i.content, i.title, i.code, i.author_user_key, String(i.problem_lc), i.problem_key].filter(Boolean).join(' '); return fuzzyIncludes(searchQ, typeof t === 'object' ? JSON.stringify(t) : t) }) }, [items, searchQ])
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <h2 className="text-lg font-semibold text-text-primary">Moderation</h2>
      <div className="mt-3 flex gap-2">
        {['comments', 'solutions', 'notes'].map((t) => (<button key={t} type="button" onClick={() => { setSubTab(t); setDeleteId(null) }} className={`rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors ${subTab === t ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}>{t}</button>))}
      </div>
      <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={13} /><input type="text" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={`Search ${subTab}…`} className="h-8 w-full border border-border-subtle bg-base pl-8 pr-2 text-xs text-text-primary outline-none focus:border-accent focus:bg-surface" /></label>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {loading ? <p className="py-8 text-center text-xs text-text-muted">Loading…</p> : null}
        {!loading && filtered.length === 0 ? <p className="py-8 text-center text-xs text-text-muted">No {subTab}.</p> : null}
        {filtered.map((item) => {
          const isReply = subTab === 'comments' && item.parent_comment_id
          const isShared = (subTab === 'solutions' && item.source_solution_id) || (subTab === 'notes' && item.source_note_id)
          return (
            <div key={item.id} className={`group flex items-start justify-between gap-3 border-b border-border-subtle bg-transparent px-2 py-3 transition-colors hover:bg-surface-hover ${isReply ? 'ml-6' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-semibold text-text-primary">{item.author_user_key}</span>
                  <Link to={`${problemUrl(item.problem_key || item.problem_lc)}${subTab === 'comments' ? `?tab=comments&comment=${item.id}` : subTab === 'solutions' ? `?tab=shared&sharedSolution=${item.id}` : `?tab=notes&notesView=shared&sharedNote=${item.id}`}`} className="text-accent transition-colors hover:text-accent-hover hover:underline">{item.problem_key || `LC#${item.problem_lc}`}</Link>
                  {isReply ? <Badge color="muted">reply</Badge> : null}{isShared ? <Badge>shared</Badge> : null}{item.language ? <Badge color="muted">{item.language}</Badge> : null}
                  <span className="text-text-muted">{fmt(item.created_at)}</span>
                </div>
                {item.title && subTab !== 'comments' ? <p className="mt-1 text-xs font-medium text-text-primary">{item.title}</p> : null}
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted line-clamp-2">{text(item)}</p>
              </div>
              <button type="button" onClick={() => void del(item.id)} className={`shrink-0 flex h-6 items-center rounded-sm border px-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 ${deleteId === item.id ? 'border-red-500/40 bg-red-500/10 text-red-400 opacity-100' : 'border-border-subtle text-text-muted hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5'}`}><Trash2 size={10} className="mr-1" />{deleteId === item.id ? 'Sure?' : 'Delete'}</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── ANNOUNCEMENTS TAB ───────────────────────────────────────── */
function AnnouncementsTab({ userKey }) {
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [history, setHistory] = useState([]); const [loadingH, setLoadingH] = useState(false); const [deleteId, setDeleteId] = useState(null)
  const load = useCallback(async () => { if (!supabase) return; setLoadingH(true); try { const { data } = await supabase.from('notifications').select('*').eq('type', 'announcement').eq('actor_user_key', userKey).order('created_at', { ascending: false }).limit(100); setHistory(data ?? []) } catch { setHistory([]) } finally { setLoadingH(false) } }, [userKey])
  useEffect(() => { void load() }, [load])

  const send = async () => { if (!supabase || !title.trim()) return; setBusy(true); setMsg(''); try { const { error } = await supabase.rpc('send_announcement', { p_admin_user_key: userKey, p_title: title.trim(), p_body: body.trim() }); if (error) throw error; setMsg('Sent!'); setTitle(''); setBody(''); await load() } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false); setTimeout(() => setMsg(''), 3000) } }
  const del = async (id) => { if (!supabase) return; if (deleteId !== id) { setDeleteId(id); return }; const target = history.find((n) => n.id === id); if (!target) return; const p = typeof target.payload === 'string' ? JSON.parse(target.payload) : target.payload; await supabase.from('notifications').delete().eq('type', 'announcement').eq('actor_user_key', userKey).eq('payload->>title', p.title).eq('payload->>body', p.body || ''); setDeleteId(null); await load() }
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  const deduped = useMemo(() => { const seen = new Map(); for (const n of history) { const p = typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload; const k = `${p.title}||${p.body}||${new Date(n.created_at).toISOString().substring(0, 16)}`; if (!seen.has(k)) seen.set(k, { ...n, _c: 1, _p: p }); else seen.get(k)._c += 1 }; return Array.from(seen.values()) }, [history])

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <h2 className="text-lg font-semibold text-text-primary">Announcements</h2>
      
      <div className="mt-4 flex flex-col gap-3 rounded-md border border-border-subtle bg-surface p-4">
        <div className="flex items-center gap-2">
          <Megaphone size={14} className="text-accent" />
          <Label>New Broadcast</Label>
        </div>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="Announcement Title…" className="h-9 w-full bg-base px-3 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} rows={3} placeholder="Optional detailed message…" className="w-full resize-none bg-base px-3 py-2 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent disabled:opacity-60" />
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => void send()} disabled={busy || !title.trim()} className="h-8 rounded-sm bg-accent px-4 text-xs font-medium text-black hover:bg-accent-hover disabled:opacity-50 transition-colors">Send Broadcast</button>
          {msg ? <span className="text-[11px] font-medium text-accent">{msg}</span> : null}
        </div>
      </div>

      <div className="mt-6 flex h-full min-h-0 flex-1 flex-col overflow-hidden pr-1">
        <div className="mb-2 flex items-center justify-between">
          <Label>Broadcast History</Label>
          <span className="text-[10px] text-text-muted">{deduped.length} total</span>
        </div>
        
        <div className="flex-1 space-y-1 overflow-y-auto">
          {loadingH ? <p className="py-8 text-center text-xs text-text-muted">Loading…</p> : null}
          {!loadingH && deduped.length === 0 ? <p className="py-8 text-center text-xs text-text-muted">No broadcasting history found.</p> : null}
          {deduped.map((n) => (
            <div key={n.id} className="group flex items-start justify-between gap-3 border-b border-border-subtle bg-transparent px-2 py-3 transition-colors hover:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-text-primary">{n._p.title}</p>
                  <span className="text-[10px] text-text-muted">{fmt(n.created_at)}</span>
                </div>
                {n._p.body ? <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{n._p.body}</p> : null}
                <div className="mt-1 flex items-center gap-2">
                  <Badge color="muted">{n._c} recipient{n._c !== 1 ? 's' : ''}</Badge>
                </div>
              </div>
              <button type="button" onClick={() => void del(n.id)} className={`shrink-0 flex h-6 items-center rounded-sm border px-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 ${deleteId === n.id ? 'border-red-500/40 bg-red-500/10 text-red-400 opacity-100' : 'border-border-subtle text-text-muted hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5'}`}><Trash2 size={10} className="mr-1" />{deleteId === n.id ? 'Sure?' : 'Delete'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────── */
/*  SYSTEM TAB  ·  Compact dashboard within 100vh                */
/* ────────────────────────────────────────────────────────────── */
function SystemTab() {
  const { activeTrackKey, userKey: currentUserKey } = useCurrentUser()
  const [activeSection, setActiveSection] = useState('overview')
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [userProgress, setUserProgress] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [globalStats, setGlobalStats] = useState({ comments: 0, solutions: 0, notes: 0 })
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createSuccess, setCreateSuccess] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteSuccess, setDeleteSuccess] = useState('')
  const [deleteMenuKey, setDeleteMenuKey] = useState(null)
  const [deleteConfirmKey, setDeleteConfirmKey] = useState(null)
  const [copiedField, setCopiedField] = useState('')
  const [userKeyEdited, setUserKeyEdited] = useState(false)
  const [createForm, setCreateForm] = useState(() => ({
    displayName: '',
    email: '',
    userKey: '',
    password: buildGeneratedPassword(),
    isAdmin: false,
  }))
  const runnerConfigured = isRunnerConfigured()

  const problemsState = useProblems()
  const allFlat = useMemo(
    () => flattenProblems(problemsState.data ?? []).filter((row) => (row.track || 'dsa') === activeTrackKey),
    [activeTrackKey, problemsState.data],
  )
  const totalProblems = allFlat.length

  const loadUsers = useCallback(async (preferredUserKey = null) => {
    if (!supabase) return
    setLoadingUsers(true)
    try {
      const [u, c, s, n] = await Promise.all([
        supabase.from('app_users').select('*').neq('user_key', 'SYSTEM').order('created_at'),
        supabase.from('problem_comments').select('id', { count: 'exact', head: true }),
        supabase.from('shared_solutions').select('id', { count: 'exact', head: true }),
        supabase.from('shared_notes').select('id', { count: 'exact', head: true }),
      ])

      const list = u.data ?? []
      setUsers(list)
      setGlobalStats({ comments: c.count ?? 0, solutions: s.count ?? 0, notes: n.count ?? 0 })
      setSelectedUser((current) => {
        const requested = preferredUserKey && list.some((item) => item.user_key === preferredUserKey) ? preferredUserKey : null
        if (requested) {
          return requested
        }
        if (current && list.some((item) => item.user_key === current)) {
          return current
        }
        return list[0]?.user_key ?? null
      })
    } catch {
      setUsers([])
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    if (!supabase || !selectedUser) return
    setLoadingProgress(true)
    const go = async () => {
      try { const { data } = await supabase.from('progress').select('*').eq('user_key', selectedUser); setUserProgress(data ?? []) }
      catch { setUserProgress([]) } finally { setLoadingProgress(false) }
    }
    void go()
  }, [selectedUser])

  useEffect(() => {
    if (userKeyEdited) {
      return
    }

    setCreateForm((current) => ({
      ...current,
      userKey: deriveAdminUserKey({ displayName: current.displayName, email: current.email }),
    }))
  }, [createForm.displayName, createForm.email, userKeyEdited])

  const problemsByIdentity = useMemo(() => {
    const map = new Map()
    for (const row of allFlat) {
      const key = problemIdentityKey(row.problemKey || row.lc)
      if (key) {
        map.set(key, row)
      }
    }
    return map
  }, [allFlat])

  const visibleIdentityKeys = useMemo(
    () => new Set(allFlat.map((row) => problemIdentityKey(row.problemKey || row.lc)).filter(Boolean)),
    [allFlat],
  )

  const filteredUserProgress = useMemo(
    () => userProgress.filter((row) => visibleIdentityKeys.has(problemIdentityKey(row.problem_key ?? row.problem_lc))),
    [userProgress, visibleIdentityKeys],
  )

  const a = useMemo(() => {
    const solved = filteredUserProgress.filter((p) => p.status === 'solved')
    const attempted = filteredUserProgress.filter((p) => p.status === 'attempted')
    const review = filteredUserProgress.filter((p) => p.status === 'review')
    const diff = { Easy: 0, Medium: 0, Hard: 0 }
    for (const p of solved) {
      const m = problemsByIdentity.get(problemIdentityKey(p.problem_key ?? p.problem_lc))
      if (m) {
        diff[m.difficulty] = (diff[m.difficulty] || 0) + 1
      }
    }

    // Tier
    const tier = { 1: { t: 0, s: 0 }, 2: { t: 0, s: 0 }, 3: { t: 0, s: 0 } }
    for (const r of allFlat) { if (tier[r.tier]) tier[r.tier].t += 1 }
    for (const p of solved) {
      const m = problemsByIdentity.get(problemIdentityKey(p.problem_key ?? p.problem_lc))
      if (m && tier[m.tier]) tier[m.tier].s += 1
    }

    // Velocity 14d
    const now = new Date(); const vel = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      const ds = d.toISOString().substring(0, 10)
      vel.push({ label: d.toLocaleDateString('en-US', { day: 'numeric' }), value: solved.filter((p) => p.solved_at && p.solved_at.substring(0, 10) === ds).length })
    }

    // Recent
    const recent = [...solved].filter((p) => p.solved_at).sort((x, y) => new Date(y.solved_at).getTime() - new Date(x.solved_at).getTime()).slice(0, 5)

    return { solved: solved.length, attempted: attempted.length, review: review.length, diff, tier, vel, recent, pct: totalProblems > 0 ? Math.round((solved.length / totalProblems) * 100) : 0 }
  }, [filteredUserProgress, problemsByIdentity, allFlat, totalProblems])

  const selectedUserObj = users.find((u) => u.user_key === selectedUser)
  const isCurrentUserSelected = selectedUserObj?.user_key === currentUserKey
  const adminCount = users.filter((u) => u.is_admin).length
  const mappedCount = users.filter((u) => Boolean(u.auth_user_id)).length
  const attemptedCount = filteredUserProgress.filter((row) => row.status === 'attempted').length
  const reviewCount = filteredUserProgress.filter((row) => row.status === 'review').length

  const recentActivity = useMemo(
    () =>
      [...filteredUserProgress]
        .filter((row) => row.status === 'solved' && row.solved_at)
        .sort((left, right) => new Date(right.solved_at).getTime() - new Date(left.solved_at).getTime())
        .slice(0, 6),
    [filteredUserProgress],
  )

  useEffect(() => {
    if (!deleteSuccess) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setDeleteSuccess('')
    }, 2600)

    return () => window.clearTimeout(timeoutId)
  }, [deleteSuccess])

  const resetCreateForm = useCallback(() => {
    setCreateForm({
      displayName: '',
      email: '',
      userKey: '',
      password: buildGeneratedPassword(),
      isAdmin: false,
    })
    setUserKeyEdited(false)
    setCreateError('')
    setCreateSuccess(null)
  }, [])

  const handleCopy = useCallback(async (value, token) => {
    try {
      await copyText(value)
      setCopiedField(token)
      window.setTimeout(() => setCopiedField((current) => (current === token ? '' : current)), 1800)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Copy failed.')
    }
  }, [])

  const handleCreateUser = useCallback(async () => {
    if (!runnerConfigured) {
      setCreateError('Runner service is not configured. Set VITE_RUNNER_API_URL before creating users.')
      return
    }

    if (!createForm.displayName.trim() || !createForm.email.trim() || !createForm.userKey.trim() || !createForm.password.trim()) {
      setCreateError('Display name, email, user key, and password are required.')
      return
    }

    setCreateBusy(true)
    setCreateError('')
    setCreateSuccess(null)

    try {
      const payload = await runnerRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          display_name: createForm.displayName.trim(),
          email: createForm.email.trim().toLowerCase(),
          user_key: normalizeAdminUserKey(createForm.userKey),
          password: createForm.password,
          is_admin: createForm.isAdmin,
        }),
      })

      setCreateSuccess({
        ...payload.user,
        password: payload?.credential?.password || createForm.password,
        generatedPassword: Boolean(payload?.credential?.generated),
      })
      await loadUsers(payload?.user?.user_key || null)
    } catch (error) {
      if (error?.code === 'SESSION_EXPIRED') {
        return
      }

      if (error?.status === 404) {
        setCreateError(
          'Runner is outdated or not deployed with admin user creation. Deploy the latest runner-service or point VITE_RUNNER_API_URL to localhost:8787.',
        )
      } else {
        setCreateError(error instanceof Error ? error.message : 'Failed to create user.')
      }
    } finally {
      setCreateBusy(false)
    }
  }, [createForm, loadUsers, resetCreateForm, runnerConfigured])

  const clearDeleteState = useCallback(() => {
    setDeleteMenuKey(null)
    setDeleteConfirmKey(null)
    setDeleteError('')
    setDeleteSuccess('')
  }, [])

  const handleSelectUser = useCallback((nextUserKey) => {
    clearDeleteState()
    setSelectedUser(nextUserKey)
  }, [clearDeleteState])

  const handleDeleteUser = useCallback(async () => {
    if (!selectedUserObj?.user_key) {
      return
    }

    if (selectedUserObj.user_key === currentUserKey) {
      setDeleteError('You cannot delete your own admin account.')
      setDeleteConfirmKey(null)
      return
    }

    setDeleteBusy(true)
    setDeleteError('')
    setDeleteSuccess('')
    setDeleteMenuKey(null)

    try {
      const deleteParams = new URLSearchParams()
      if (selectedUserObj.auth_user_id) {
        deleteParams.set('auth_user_id', selectedUserObj.auth_user_id)
      }

      const deletePath = deleteParams.size
        ? `/admin/users/${encodeURIComponent(selectedUserObj.user_key)}?${deleteParams.toString()}`
        : `/admin/users/${encodeURIComponent(selectedUserObj.user_key)}`

      await runnerRequest(deletePath, {
        method: 'DELETE',
      })

      setDeleteConfirmKey(null)
      setDeleteSuccess('User deleted.')
      await loadUsers(null)
    } catch (error) {
      if (error?.code === 'SESSION_EXPIRED') {
        clearDeleteState()
        return
      }

      if (error?.status === 404) {
        setDeleteError('User not found.')
      } else {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete user.')
      }
    } finally {
      setDeleteBusy(false)
    }
  }, [clearDeleteState, currentUserKey, loadUsers, selectedUserObj])

  const subNavItems = [
    {
      id: 'overview',
      label: 'Overview',
      caption: 'Track progress and activity',
      Icon: BarChart3,
    },
    {
      id: 'directory',
      label: 'Directory',
      caption: `${users.length} accounts`,
      Icon: Users,
    },
    {
      id: 'create',
      label: 'Create User',
      caption: 'Provision new access',
      Icon: UserPlus,
    },
  ]

  const renderUserSummary = () => (
    <div className="mt-3 grid grid-cols-5 gap-2">
      <StatBox label="Users" value={users.length} accent />
      <StatBox label="Mapped Auth" value={mappedCount} />
      <StatBox label="Admins" value={adminCount} />
      <StatBox label="Comments" value={globalStats.comments} />
      <StatBox label="Shared" value={globalStats.notes + globalStats.solutions} />
    </div>
  )

  const renderOverview = () => (
    <>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border border-border-subtle bg-surface px-3 py-3">
        <div className="min-w-[240px] flex-1">
          <Label>Focus User</Label>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {loadingUsers ? (
                <span className="text-xs text-text-muted">Loading users…</span>
              ) : (
                <div className="w-56">
                  <CustomSelect
                    value={selectedUser || ''}
                    onChange={(value) => handleSelectUser(value)}
                    options={users.map((user) => ({
                      value: user.user_key,
                      label: `${user.display_name}${user.is_admin ? ' ★' : ''}`,
                    }))}
                    placeholder="Select user…"
                  />
                </div>
              )}
              {selectedUserObj ? (
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <Badge color={selectedUserObj.is_admin ? 'accent' : 'muted'}>
                    {selectedUserObj.is_admin ? 'Admin' : 'User'}
                  </Badge>
                  <span>{selectedUserObj.user_key}</span>
                  <span>{selectedUserObj.auth_user_id ? 'Linked auth' : 'Needs auth mapping'}</span>
                </div>
              ) : null}
            </div>

            {selectedUserObj && !isCurrentUserSelected ? (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError('')
                    if (deleteMenuKey === selectedUserObj.user_key) {
                      setDeleteMenuKey(null)
                      setDeleteConfirmKey(null)
                      return
                    }

                    setDeleteConfirmKey(null)
                    setDeleteMenuKey(selectedUserObj.user_key)
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center border border-border-subtle text-text-muted transition-colors hover:border-accent hover:text-accent"
                  title="User actions"
                >
                  <MoreHorizontal size={14} />
                </button>

                {deleteMenuKey === selectedUserObj.user_key && deleteConfirmKey !== selectedUserObj.user_key ? (
                  <div className="absolute right-0 top-9 z-10 min-w-[128px] overflow-hidden border border-border-subtle bg-base shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteMenuKey(null)
                        setDeleteError('')
                        setDeleteConfirmKey(selectedUserObj.user_key)
                      }}
                      className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-[11px] text-text-muted transition-colors hover:bg-surface hover:text-red-300"
                    >
                      <Trash2 size={11} />
                      Delete user
                    </button>
                  </div>
                ) : null}

                {deleteConfirmKey === selectedUserObj.user_key ? (
                  <div className="absolute right-0 top-9 z-20 w-[320px] border border-border-subtle bg-base p-3 shadow-lg">
                    <p className="text-[11px] leading-5 text-text-primary">
                      Delete <span className="font-medium">{selectedUserObj.display_name}</span>? This removes the Practicer login and user data.
                    </p>
                    {deleteError ? <p className="mt-2 text-[11px] text-red-400">{deleteError}</p> : null}
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmKey(null)
                          setDeleteError('')
                        }}
                        disabled={deleteBusy}
                        className="h-8 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteUser()}
                        disabled={deleteBusy}
                        className="h-8 border border-red-500/35 px-3 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deleteBusy ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {deleteSuccess ? <p className="mt-3 text-[11px] text-accent">User deleted.</p> : null}
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="grid min-w-[280px] grid-cols-3 gap-2">
            <StatBox label="Solved" value={a.solved} accent />
            <StatBox label="Attempted" value={attemptedCount} />
            <StatBox label="Review" value={reviewCount} />
          </div>
        </div>
      </div>

      {loadingProgress ? (
        <p className="mt-4 text-center text-xs text-text-muted">Loading…</p>
      ) : (
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 grid-rows-[auto_1fr_1fr] gap-2 overflow-hidden">
          <div className="col-span-3 grid grid-cols-5 gap-2">
            <StatBox label="Solved" value={a.solved} accent />
            <StatBox label="Attempted" value={a.attempted} />
            <StatBox label="Review" value={a.review} />
            <StatBox label="Unsolved" value={Math.max(0, totalProblems - a.solved - a.attempted - a.review)} />
            <StatBox label="Completion" value={`${a.pct}%`} accent />
          </div>

          <div className="flex flex-col border border-border-subtle bg-surface p-2">
            <Label>Difficulty</Label>
            <div className="mt-1 flex-1">
              <MiniBar
                data={[
                  { label: 'Easy', value: a.diff.Easy },
                  { label: 'Med', value: a.diff.Medium },
                  { label: 'Hard', value: a.diff.Hard },
                ]}
                colors={{ Easy: '#22c55e', Med: '#f59e0b', Hard: '#ef4444' }}
              />
            </div>
          </div>

          <div className="col-span-2 flex flex-col border border-border-subtle bg-surface p-2">
            <Label>14-Day Velocity</Label>
            <div className="mt-1 flex-1">
              <MiniBar data={a.vel} />
            </div>
          </div>

          <div className="flex flex-col border border-border-subtle bg-surface p-2">
            <Label>Tiers</Label>
            <div className="mt-1 flex flex-1 flex-col justify-center space-y-1.5">
              {[1, 2, 3].map((tierValue) => (
                <ThinBar key={tierValue} label={`Tier ${tierValue}`} value={a.tier[tierValue].s} max={a.tier[tierValue].t} />
              ))}
            </div>
          </div>

          <div className="col-span-2 flex flex-col overflow-hidden border border-border-subtle bg-surface p-2">
            <Label>Recent Solves</Label>
            <div className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
              {a.recent.length === 0 ? <p className="py-2 text-[10px] text-text-muted">No solves yet.</p> : null}
              {a.recent.map((solve) => {
                const match = problemsByIdentity.get(problemIdentityKey(solve.problem_key ?? solve.problem_lc))
                const problemIdentity = match?.problemKey || solve.problem_key || solve.problem_lc
                return (
                  <div key={problemIdentity} className="flex items-center justify-between py-0.5 text-[11px]">
                    <Link to={problemUrl(problemIdentity, match?.title || '')} className="truncate text-text-primary hover:text-accent">
                      {match ? match.title : problemIdentity || `LC#${solve.problem_lc}`}
                    </Link>
                    <span className="ml-2 shrink-0 text-[10px] text-text-muted">
                      {solve.solved_at ? new Date(solve.solved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )

  const renderDirectory = () => (
    <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(320px,1.05fr)_minmax(0,1fr)] gap-3 overflow-hidden">
      <div className="flex min-h-0 flex-col border border-border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <Label>User Directory</Label>
            <p className="mt-1 text-sm text-text-primary">{users.length} accounts across Practicer</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('create')}
            className="h-8 border border-accent bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20"
          >
            <UserPlus size={12} className="mr-1 inline" />
            New User
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loadingUsers ? <p className="py-8 text-center text-xs text-text-muted">Loading users…</p> : null}
          {!loadingUsers && users.length === 0 ? <p className="py-8 text-center text-xs text-text-muted">No users found.</p> : null}
          <div className="space-y-1">
            {users.map((user) => {
              const isSelected = selectedUser === user.user_key
              return (
                <button
                  key={user.user_key}
                  type="button"
                  onClick={() => handleSelectUser(user.user_key)}
                  className={[
                    'w-full border px-3 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border-subtle bg-base hover:border-accent/20 hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{user.display_name}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">{user.user_key}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {user.is_admin ? <Badge>Admin</Badge> : <Badge color="muted">User</Badge>}
                      <Badge color={user.auth_user_id ? 'accent' : 'muted'}>
                        {user.auth_user_id ? 'Linked' : 'Pending'}
                      </Badge>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <div className="border border-border-subtle bg-surface px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Label>Selected User</Label>
              <p className="mt-1 text-lg font-semibold text-text-primary">
                {selectedUserObj ? selectedUserObj.display_name : 'No user selected'}
              </p>
              {selectedUserObj ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                  <Badge color={selectedUserObj.is_admin ? 'accent' : 'muted'}>
                    {selectedUserObj.is_admin ? 'Admin' : 'Standard'}
                  </Badge>
                  <span>{selectedUserObj.user_key}</span>
                  <span>{selectedUserObj.auth_user_id ? 'Auth linked' : 'Awaiting auth mapping'}</span>
                </div>
              ) : null}
            </div>
            <div className="grid min-w-[220px] grid-cols-3 gap-2">
              <StatBox label="Solved" value={a.solved} accent />
              <StatBox label="Attempted" value={attemptedCount} />
              <StatBox label="Review" value={reviewCount} />
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-3 overflow-hidden">
          <div className="flex min-h-0 flex-col border border-border-subtle bg-surface p-3">
            <Label>Recent Track Activity</Label>
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
              {recentActivity.length === 0 ? <p className="py-8 text-center text-xs text-text-muted">No recent solves on this track.</p> : null}
              {recentActivity.map((row) => {
                const match = problemsByIdentity.get(problemIdentityKey(row.problem_key ?? row.problem_lc))
                const problemIdentity = match?.problemKey || row.problem_key || row.problem_lc
                return (
                  <div key={`${problemIdentity}-${row.solved_at || 'pending'}`} className="border border-border-subtle bg-base px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={problemUrl(problemIdentity, match?.title || '')} className="truncate text-sm text-text-primary hover:text-accent">
                          {match?.title || problemIdentity || `LC#${row.problem_lc}`}
                        </Link>
                        <p className="mt-1 text-[11px] text-text-muted">
                          {match?.difficulty || '—'} · {row.status}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {row.solved_at ? new Date(row.solved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="border border-border-subtle bg-surface p-3">
              <Label>Completion</Label>
              <div className="mt-3 space-y-2">
                <ThinBar label="Solved" value={a.solved} max={totalProblems} color="#22c55e" />
                <ThinBar label="Attempted" value={attemptedCount} max={totalProblems} color="#f59e0b" />
                <ThinBar label="Review" value={reviewCount} max={totalProblems} color="#38bdf8" />
              </div>
            </div>
            <div className="border border-border-subtle bg-surface p-3">
              <Label>Difficulty Wins</Label>
              <div className="mt-3 space-y-2">
                <ThinBar label="Easy" value={a.diff.Easy} max={Math.max(a.solved, 1)} color="#22c55e" />
                <ThinBar label="Medium" value={a.diff.Medium} max={Math.max(a.solved, 1)} color="#f59e0b" />
                <ThinBar label="Hard" value={a.diff.Hard} max={Math.max(a.solved, 1)} color="#ef4444" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderCreate = () => (
    <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] border border-border-subtle bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Create User</h3>
          </div>
          <button
            type="button"
            onClick={resetCreateForm}
            className="h-8 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent"
          >
            Reset
          </button>
        </div>

        {createSuccess ? (
          <div className="mt-4 flex items-center gap-3 border border-accent/30 bg-accent/5 px-4 py-3">
            <Check size={14} className="shrink-0 text-accent" />
            <p className="text-sm font-medium text-text-primary">User created.</p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <Label>Display Name</Label>
            <input
              type="text"
              value={createForm.displayName}
              onChange={(event) => {
                const value = event.target.value
                setCreateError('')
                setCreateSuccess(null)
                setCreateForm((current) => ({ ...current, displayName: value }))
              }}
              placeholder="Ayan Kapoor"
              className="mt-2 h-10 w-full border border-border-subtle bg-base px-3 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <Label>Email</Label>
            <div className="relative mt-2">
              <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="email"
                value={createForm.email}
                onChange={(event) => {
                  const value = event.target.value
                  setCreateError('')
                  setCreateSuccess(null)
                  setCreateForm((current) => ({ ...current, email: value }))
                }}
                placeholder="name@example.com"
                className="h-10 w-full border border-border-subtle bg-base pl-10 pr-3 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>
          </label>

          <label className="block">
            <Label>User Key</Label>
            <input
              type="text"
              value={createForm.userKey}
              onChange={(event) => {
                setUserKeyEdited(true)
                setCreateError('')
                setCreateSuccess(null)
                setCreateForm((current) => ({ ...current, userKey: normalizeAdminUserKey(event.target.value) }))
              }}
              placeholder="AYAN"
              className="mt-2 h-10 w-full border border-border-subtle bg-base px-3 font-mono text-sm uppercase text-text-primary outline-none focus:border-accent"
            />
          </label>

          <div className="block">
            <Label>Access Level</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { value: false, label: 'Standard', hint: 'Learner access' },
                { value: true, label: 'Admin', hint: 'Can open admin routes' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => {
                    setCreateError('')
                    setCreateSuccess(null)
                    setCreateForm((current) => ({ ...current, isAdmin: option.value }))
                  }}
                  className={[
                    'border px-3 py-3 text-left transition-colors',
                    createForm.isAdmin === option.value
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border-subtle bg-base hover:border-accent/20 hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <Shield size={13} className={createForm.isAdmin === option.value ? 'text-accent' : 'text-text-muted'} />
                    <span className="text-sm font-medium text-text-primary">{option.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-text-muted">{option.hint}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 border border-border-subtle bg-base p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-accent" />
              <Label>Password</Label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateError('')
                  setCreateSuccess(null)
                  setCreateForm((current) => ({ ...current, password: buildGeneratedPassword() }))
                }}
                className="h-8 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent"
              >
                Generate
              </button>
              <button
                type="button"
                onClick={() => void handleCopy(createForm.password, 'draft-password')}
                className="h-8 border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent"
              >
                <Copy size={11} className="mr-1 inline" />
                {copiedField === 'draft-password' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <input
            type="text"
            value={createForm.password}
            onChange={(event) => {
              setCreateError('')
              setCreateSuccess(null)
              setCreateForm((current) => ({ ...current, password: event.target.value }))
            }}
            className="mt-3 h-10 w-full border border-border-subtle bg-surface px-3 font-mono text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>

        {createError ? <p className="mt-4 text-[11px] text-red-400">{createError}</p> : null}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreateUser()}
            disabled={createBusy}
            className="h-10 border border-accent bg-accent px-4 text-sm font-medium text-black hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createBusy ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">System</h2>
          <p className="mt-1 text-[11px] text-text-muted">Global operations, user access, and track-level oversight</p>
        </div>
        <div className="flex gap-2">
          <StatBox label={`${activeTrackKey === 'sql' ? 'SQL' : 'DSA'} Problems`} value={totalProblems} />
          <StatBox label="Solutions" value={globalStats.solutions} />
          <StatBox label="Comments" value={globalStats.comments} />
          <StatBox label="Admins" value={adminCount} />
        </div>
      </div>
      {renderUserSummary()}
      <div className="mt-3 flex gap-2">
        {subNavItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveSection(item.id)}
            className={[
              'min-w-[170px] border px-3 py-2 text-left transition-colors',
              activeSection === item.id
                ? 'border-accent/40 bg-accent/10'
                : 'border-border-subtle bg-surface hover:border-accent/20 hover:bg-surface-hover',
            ].join(' ')}
          >
            <div className="flex items-center gap-2">
              <item.Icon size={13} className={activeSection === item.id ? 'text-accent' : 'text-text-muted'} />
              <span className="text-sm font-medium text-text-primary">{item.label}</span>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">{item.caption}</p>
          </button>
        ))}
      </div>

      {activeSection === 'overview' ? renderOverview() : null}
      {activeSection === 'directory' ? renderDirectory() : null}
      {activeSection === 'create' ? renderCreate() : null}
    </div>
  )
}

/* ── MAIN ────────────────────────────────────────────────────── */
export function AdminPage() {
  const { userKey, activeUser } = useCurrentUser()
  const [activeTab, setActiveTab] = useState('problems')
  return (
    <Motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex h-full">
      <aside className="flex w-[148px] shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="border-b border-border-subtle px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Admin</p>{activeUser ? <p className="mt-0.5 text-[11px] text-text-muted">{activeUser.label}</p> : null}</div>
        <nav className="flex flex-1 flex-col gap-px p-1.5">
          {TABS.map((tab) => (<button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={['flex items-center gap-2 px-2.5 py-2 text-left text-xs font-medium transition-colors', activeTab === tab.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-elevated hover:text-text-primary'].join(' ')}><tab.Icon size={14} />{tab.label}</button>))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-hidden">
        {activeTab === 'problems' ? <ProblemsTab /> : null}
        {activeTab === 'moderation' ? <ModerationTab /> : null}
        {activeTab === 'announcements' ? <AnnouncementsTab userKey={userKey} /> : null}
        {activeTab === 'system' ? <SystemTab /> : null}
      </div>
    </Motion.section>
  )
}
