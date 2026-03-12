import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { buildProblemPresentation, deriveProblemEntryPoint, normalizeProblemDescriptionForStorage } from '../../lib/problem-content'
import { companiesToInput, parseCompanyInput } from '../../lib/problem-utils'
import {
  buildProblemKey,
  defaultPhaseChoicesForTrack,
  SQL_COMPARISON_MODE_OPTIONS,
  SQL_RESULT_MODE_OPTIONS,
  SQL_SUBMISSION_KIND_OPTIONS,
  TRACK_OPTIONS,
} from '../../lib/catalog-admin'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'

function createEmptyExample() {
  return { input: '', output: '', explanation: '' }
}

function createEmptyTestCase() {
  return { input_text: '', expected_output: '', notes: '' }
}

function createEmptyFixture() {
  return {
    fixture_key: '',
    label: '',
    is_public: false,
    setup_sql: '',
    postcheck_sql: '',
    expected_columns_text: '[]',
    expected_rows_text: '[]',
    comparison_mode: 'unordered_multiset',
    order_required: false,
    notes: '',
  }
}

function parseTagInput(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || '').trim() || JSON.stringify(fallback))
    return parsed
  } catch {
    return fallback
  }
}

function cloneJsonValue(value) {
  if (value == null) {
    return value
  }

  return JSON.parse(JSON.stringify(value))
}

function normalizePresentationObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    return null
  }

  return cloneJsonValue(value)
}

function prettyJson(value, fallback) {
  return JSON.stringify(value ?? fallback, null, 2)
}

function parseJsonOrThrow(label, value, fallback) {
  const text = String(value ?? '').trim()
  if (!text) {
    return cloneJsonValue(fallback)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
}

function parseJsonArrayOrThrow(label, value, fallback = []) {
  const parsed = parseJsonOrThrow(label, value, fallback)
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`)
  }
  return parsed
}

function markdownTable(columns, rows) {
  const normalizedColumns = Array.isArray(columns) ? columns.map((column) => String(column ?? '').trim()) : []
  const normalizedRows = Array.isArray(rows) ? rows : []
  if (normalizedColumns.length === 0) {
    return ''
  }

  const header = `| ${normalizedColumns.join(' | ')} |`
  const divider = `| ${normalizedColumns.map(() => ':---').join(' | ')} |`
  const body = normalizedRows
    .map((row) => {
      const cells = Array.isArray(row) ? row : []
      return `| ${normalizedColumns.map((_, index) => String(cells[index] ?? '')).join(' | ')} |`
    })
    .join('\n')

  return [header, divider, body].filter(Boolean).join('\n')
}

function sqlStructuredExamplesToLegacyExamples(examples) {
  if (!Array.isArray(examples)) {
    return []
  }

  return examples
    .map((example) => {
      const input = Array.isArray(example?.tables)
        ? example.tables
            .map((table) => {
              const tableName = String(table?.name || 'table').trim()
              const tableMarkdown = markdownTable(table?.columns || [], table?.rows || [])
              return tableMarkdown ? `${tableName} table:\n${tableMarkdown}` : ''
            })
            .filter(Boolean)
            .join('\n\n')
        : ''
      const output = example?.output ? markdownTable(example.output.columns || [], example.output.rows || []) : ''
      const explanation = String(example?.explanation || '').trim()

      return {
        input,
        output,
        ...(explanation ? { explanation } : {}),
      }
    })
    .filter((example) => example.input || example.output || example.explanation)
}

function phaseLabelFor(phaseChoices, phaseValue) {
  const match = phaseChoices.find((choice) => Number(choice.phase) === Number(phaseValue))
  return match?.name || ''
}

function dsaDefaults(phaseChoices) {
  const firstPhase = phaseChoices[0] ?? { phase: 1, name: 'Frequency & Hashing' }
  return {
    track_key: 'dsa',
    phase: Number(firstPhase.phase),
    phase_name: firstPhase.name,
    phase_order: 1,
    tier: 1,
    study_order: '',
    title: '',
    slug: '',
    difficulty: '',
    category: '',
    source_platform: 'LeetCode',
    source_problem_id: '',
    source_url: '',
    canonical_source_url: '',
    faang_verification: '',
    inclusion_rationale: '',
    companies: '',
    tags: '',
    statement: '',
    starter_snippet: '',
    entry_point: '',
    examples: [createEmptyExample()],
    presentation: null,
    sql_schema_text: '[]',
    sql_examples_text: '[]',
    sql_requirements_text: '[]',
    problem_lc: '',
    leetcode_url: '',
    neetcode_url: '',
    companion_lc: '',
    companion_label: '',
    companion_notes: '',
    seed_test_cases: [createEmptyTestCase()],
    dialect_original: '',
    dialect_runtime: 'postgres14',
    submission_kind: 'query',
    result_mode: 'direct_result',
    sql_notes: '',
    reference_sql_original: '',
    reference_sql_runtime: '',
    fixtures: [createEmptyFixture()],
  }
}

function sqlDefaults() {
  const firstPhase = defaultPhaseChoicesForTrack('sql')[0]
  return {
    track_key: 'sql',
    phase: Number(firstPhase.phase),
    phase_name: firstPhase.name,
    phase_order: 1,
    tier: 1,
    study_order: '',
    title: '',
    slug: '',
    difficulty: '',
    category: '',
    source_platform: 'LeetCode',
    source_problem_id: '',
    source_url: '',
    canonical_source_url: '',
    faang_verification: '',
    inclusion_rationale: '',
    companies: '',
    tags: '',
    statement: '',
    starter_snippet: 'SELECT\n  -- your code here\n;',
    entry_point: '',
    examples: [createEmptyExample()],
    presentation: null,
    sql_schema_text: '[]',
    sql_examples_text: '[]',
    sql_requirements_text: '[]',
    problem_lc: '',
    leetcode_url: '',
    neetcode_url: '',
    companion_lc: '',
    companion_label: '',
    companion_notes: '',
    seed_test_cases: [createEmptyTestCase()],
    dialect_original: 'PostgreSQL',
    dialect_runtime: 'postgres14',
    submission_kind: 'query',
    result_mode: 'direct_result',
    sql_notes: '',
    reference_sql_original: '',
    reference_sql_runtime: '',
    fixtures: [createEmptyFixture()],
  }
}

function buildDefaultForm(trackKey, phaseChoices) {
  return trackKey === 'sql' ? sqlDefaults() : dsaDefaults(phaseChoices)
}

function contentToFormFields(content, trackKey = 'dsa') {
  const presentation = normalizePresentationObject(content?.presentation)
  const structuredExamples = Array.isArray(presentation?.examples) ? presentation.examples : []
  const exampleSource =
    Array.isArray(content?.input_output) && content.input_output.length > 0
      ? content.input_output
      : trackKey === 'sql'
        ? sqlStructuredExamplesToLegacyExamples(structuredExamples)
        : []
  const examples = Array.isArray(exampleSource)
    ? exampleSource
        .map((item) => ({
          input: typeof item?.input === 'string' ? item.input : item?.input != null ? JSON.stringify(item.input, null, 2) : '',
          output: typeof item?.output === 'string' ? item.output : item?.output != null ? JSON.stringify(item.output, null, 2) : '',
          explanation: typeof item?.explanation === 'string' ? item.explanation : '',
        }))
        .filter((item) => item.input || item.output || item.explanation)
    : []

  return {
    tags: Array.isArray(content?.tags) ? content.tags.join(', ') : '',
    statement: content?.statement_clean || content?.problem_description || presentation?.statement || '',
    starter_snippet: content?.starter_snippet || content?.starter_code || '',
    entry_point: content?.entry_point || '',
    examples: examples.length > 0 ? examples : [createEmptyExample()],
    presentation,
    sql_schema_text: prettyJson(presentation?.schema, []),
    sql_examples_text: prettyJson(structuredExamples, []),
    sql_requirements_text: prettyJson(presentation?.requirements, []),
    ...(presentation?.source?.platform ? { source_platform: presentation.source.platform } : {}),
    ...(presentation?.source?.canonical_url ? { canonical_source_url: presentation.source.canonical_url } : {}),
    ...(presentation?.source?.original_url ? { source_url: presentation.source.original_url } : {}),
  }
}

function toInitialForm(problem, phaseChoices) {
  const trackKey = problem?.track_key || problem?.track || 'dsa'
  const defaults = buildDefaultForm(trackKey, phaseChoices)
  if (!problem) {
    return defaults
  }

  const activePhaseChoices = defaultPhaseChoicesForTrack(trackKey, phaseChoices)
  const phase = Number(problem.phase ?? defaults.phase)
  return {
    ...defaults,
    track_key: trackKey,
    phase,
    phase_name: problem.phase_name || phaseLabelFor(activePhaseChoices, phase) || defaults.phase_name,
    phase_order: problem.phase_order ?? defaults.phase_order,
    tier: problem.tier ?? defaults.tier,
    study_order: problem.study_order ?? defaults.study_order,
    title: problem.title ?? defaults.title,
    slug: problem.slug ?? defaults.slug,
    difficulty: problem.difficulty ?? defaults.difficulty,
    category: problem.category ?? defaults.category,
    source_platform: problem.source_platform ?? defaults.source_platform,
    source_problem_id: problem.source_problem_id ?? defaults.source_problem_id,
    source_url: problem.source_url ?? defaults.source_url,
    canonical_source_url: problem.canonical_source_url ?? defaults.canonical_source_url,
    faang_verification: problem.faang_verification ?? defaults.faang_verification,
    inclusion_rationale: problem.inclusion_rationale ?? defaults.inclusion_rationale,
    companies: companiesToInput(problem.companies),
    problem_lc: problem.problem_lc ?? problem.lc ?? '',
    leetcode_url: problem.leetcode_url ?? '',
    neetcode_url: problem.neetcode_url ?? '',
    companion_lc: problem.companion_lc ?? '',
    companion_label: problem.companion_relation_label ?? '',
    companion_notes: problem.companion_relation_notes ?? '',
  }
}

function parseProblemPayload(form, showCompanion, mode) {
  const normalizedStatement = normalizeProblemDescriptionForStorage(form.statement) || String(form.statement || '').trim()
  const starterSnippet = String(form.starter_snippet || '').replace(/\r\n/g, '\n').trim()
  const explicitEntryPoint = String(form.entry_point || '').trim()
  const derivedEntryPoint = explicitEntryPoint || (() => {
    const candidate = deriveProblemEntryPoint('Solution', starterSnippet)
    return candidate === 'Solution' ? '' : candidate
  })()

  const examples = (Array.isArray(form.examples) ? form.examples : [])
    .map((example) => ({
      input: String(example?.input || '').trim(),
      output: String(example?.output || '').trim(),
      explanation: String(example?.explanation || '').trim(),
    }))
    .filter((example) => example.input || example.output || example.explanation)
    .map((example) => ({
      input: example.input,
      output: example.output,
      ...(example.explanation ? { explanation: example.explanation } : {}),
    }))

  const sourcePlatform = String(form.source_platform || '').trim()
  const sourceProblemId = String(form.source_problem_id || '').trim()
  const problemLc = numberOrNull(form.problem_lc)
  const problemKey = buildProblemKey({
    trackKey: form.track_key,
    problemLc,
    sourcePlatform,
    sourceProblemId,
    slug: form.slug,
    title: form.title,
  })

  const commonProblem = {
    track_key: form.track_key,
    module_number: Number(form.phase),
    module_name: String(form.phase_name || '').trim(),
    phase_order: Number(form.phase_order),
    tier: Number(form.tier),
    study_order: numberOrNull(form.study_order),
    title: String(form.title || '').trim(),
    slug: String(form.slug || '').trim() || null,
    difficulty: String(form.difficulty || '').trim() || null,
    category: String(form.category || '').trim() || null,
    companies: parseCompanyInput(form.companies),
    source_platform: sourcePlatform || null,
    source_problem_id: sourceProblemId || null,
    source_url: String(form.source_url || '').trim() || null,
    canonical_source_url: String(form.canonical_source_url || '').trim() || null,
    faang_verification: String(form.faang_verification || '').trim() || null,
    inclusion_rationale: String(form.inclusion_rationale || '').trim() || null,
    problem_key: problemKey || null,
  }

  const existingPresentation = normalizePresentationObject(form.presentation)
  const sqlSchema = form.track_key === 'sql' ? parseJsonArrayOrThrow('Schema', form.sql_schema_text, existingPresentation?.schema ?? []) : []
  const sqlPresentationExamples =
    form.track_key === 'sql' ? parseJsonArrayOrThrow('Examples', form.sql_examples_text, existingPresentation?.examples ?? []) : []
  const sqlRequirements =
    form.track_key === 'sql' ? parseJsonArrayOrThrow('Requirements', form.sql_requirements_text, existingPresentation?.requirements ?? []) : []
  const nextPresentation =
    form.track_key === 'sql'
      ? {
          ...(existingPresentation || {}),
          statement: normalizedStatement || existingPresentation?.statement || '',
          schema: sqlSchema,
          examples: sqlPresentationExamples,
          requirements: sqlRequirements,
          source: {
            ...(existingPresentation?.source || {}),
            platform: sourcePlatform || existingPresentation?.source?.platform || '',
            canonical_url: String(form.canonical_source_url || '').trim() || existingPresentation?.source?.canonical_url || '',
            original_url: String(form.source_url || '').trim() || existingPresentation?.source?.original_url || '',
          },
        }
      : {
          ...buildProblemPresentation({ description: normalizedStatement, examples }),
          ...(Array.isArray(existingPresentation?.visuals) && existingPresentation.visuals.length > 0
            ? { visuals: cloneJsonValue(existingPresentation.visuals) }
            : {}),
        }

  const commonContent = {
    problem_key: problemKey || null,
    tags: parseTagInput(form.tags),
    statement_raw: normalizedStatement || null,
    statement_clean: normalizedStatement || null,
    constraints_text: '',
    starter_snippet: starterSnippet || null,
    input_output: form.track_key === 'sql' ? sqlStructuredExamplesToLegacyExamples(sqlPresentationExamples) : examples,
    source: 'manual',
    editor_language: form.track_key === 'sql' ? 'sql' : 'python',
    runtime_kind: form.track_key === 'sql' ? 'sql_postgres' : 'python_problem',
    ...(nextPresentation ? { presentation: nextPresentation } : {}),
    ...(form.track_key === 'dsa'
      ? {
          title: commonProblem.title,
          difficulty: commonProblem.difficulty,
          problem_description: normalizedStatement || null,
          starter_code: starterSnippet || null,
          entry_point: derivedEntryPoint || null,
        }
      : {}),
  }

  if (form.track_key === 'sql') {
    const fixtures = (Array.isArray(form.fixtures) ? form.fixtures : [])
      .map((fixture, index) => ({
        problem_key: problemKey || null,
        fixture_key: String(fixture.fixture_key || `fixture_${index + 1}`).trim() || `fixture_${index + 1}`,
        label: String(fixture.label || `Fixture ${index + 1}`).trim() || `Fixture ${index + 1}`,
        sort_order: index + 1,
        is_public: Boolean(fixture.is_public),
        setup_sql: String(fixture.setup_sql || '').trim(),
        postcheck_sql: String(fixture.postcheck_sql || '').trim() || null,
        expected_columns: safeJsonParse(fixture.expected_columns_text, []),
        expected_rows: safeJsonParse(fixture.expected_rows_text, []),
        comparison_mode: String(fixture.comparison_mode || 'unordered_multiset'),
        order_required: Boolean(fixture.order_required),
        notes: String(fixture.notes || '').trim() || null,
        is_active: true,
      }))
      .filter((fixture) => fixture.setup_sql)

    return {
      trackKey: 'sql',
      problem: commonProblem,
      content: commonContent,
      sqlSpec: {
        problem_key: problemKey || null,
        dialect_original: String(form.dialect_original || '').trim() || 'PostgreSQL',
        dialect_runtime: String(form.dialect_runtime || '').trim() || 'postgres14',
        submission_kind: String(form.submission_kind || 'query'),
        result_mode: String(form.result_mode || 'direct_result'),
        starter_sql: starterSnippet || null,
        notes: String(form.sql_notes || '').trim() || null,
      },
      sqlFixtures: fixtures,
      sqlReferenceSolution: {
        problem_key: problemKey || null,
        reference_sql_original: String(form.reference_sql_original || '').trim() || null,
        reference_sql_runtime: String(form.reference_sql_runtime || '').trim() || null,
        provenance_notes: null,
      },
      seedTestCases: [],
      companionRelation: null,
    }
  }

  const seedTestCases = (Array.isArray(form.seed_test_cases) ? form.seed_test_cases : [])
    .map((testCase) => ({
      input_text: String(testCase?.input_text || '').trim(),
      expected_output: String(testCase?.expected_output || '').trim(),
      notes: String(testCase?.notes || '').trim(),
    }))
    .filter((testCase) => testCase.input_text || testCase.expected_output || testCase.notes)

  return {
    trackKey: 'dsa',
    problem: {
      ...commonProblem,
      source_type: 'neetcode',
      problem_lc: problemLc,
      leetcode_url: String(form.leetcode_url || '').trim() || null,
      neetcode_url: String(form.neetcode_url || '').trim() || null,
    },
    content: commonContent,
    seedTestCases: mode === 'create' ? seedTestCases : [],
    companionRelation:
      showCompanion && form.companion_lc
        ? {
            to_problem_lc: Number(form.companion_lc),
            relationship_type: 'companion',
            label: String(form.companion_label || '').trim() || null,
            notes: String(form.companion_notes || '').trim() || null,
          }
        : null,
    sqlSpec: null,
    sqlFixtures: [],
    sqlReferenceSolution: null,
  }
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      {children}
    </label>
  )
}

function Input({ value, onChange, placeholder = '', type = 'text', required = false, readOnly = false }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      readOnly={readOnly}
      className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent read-only:text-text-muted"
    />
  )
}

function TextArea({ value, onChange, placeholder = '', rows = 2, className = '' }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className={`border border-border-subtle bg-base px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent ${className}`.trim()}
    />
  )
}

function SectionTitle({ title, detail, action }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{title}</p>
        {detail ? <p className="mt-0.5 text-[11px] text-text-muted">{detail}</p> : null}
      </div>
      {action}
    </div>
  )
}

function RowActionButton({ onClick, icon, label, tone = 'default', disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-7 items-center gap-1 border px-2 text-[11px]',
        tone === 'danger'
          ? 'border-border-subtle text-text-muted hover:border-red-500/40 hover:text-red-400 disabled:opacity-40'
          : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent disabled:opacity-40',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function PhaseSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
    >
      {options.map((choice) => (
        <option key={`${choice.phase}-${choice.name}`} value={choice.phase}>
          {`${choice.phase}. ${choice.name}`}
        </option>
      ))}
    </select>
  )
}

export function ProblemModal({ open, mode, problem, saving, onClose, onSave, phaseOptions = [] }) {
  const initialTrack = problem?.track_key || problem?.track || 'dsa'
  const [trackKey, setTrackKey] = useState(initialTrack)
  const activePhaseChoices = useMemo(
    () => defaultPhaseChoicesForTrack(trackKey, phaseOptions),
    [trackKey, phaseOptions],
  )
  const [form, setForm] = useState(() => toInitialForm(problem, activePhaseChoices))
  const [showCompanion, setShowCompanion] = useState(() => Boolean(problem?.companion_lc))
  const [contentLoading, setContentLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    const nextTrack = problem?.track_key || problem?.track || 'dsa'
    const nextPhaseChoices = defaultPhaseChoicesForTrack(nextTrack, phaseOptions)
    setTrackKey(nextTrack)
    setForm(toInitialForm(problem, nextPhaseChoices))
    setShowCompanion(Boolean(problem?.companion_lc))
  }, [open, problem, phaseOptions])

  useEffect(() => {
    if (!open || !problem || !supabase) {
      setContentLoading(false)
      return
    }

    let cancelled = false
    setContentLoading(true)

    const load = async () => {
      try {
        const track = problem.track_key || problem.track || 'dsa'
        const contentQuery = supabase
          .from('problem_content')
          .select('*')

        const contentFilter =
          track === 'sql' && problem.problem_key
            ? contentQuery.eq('problem_key', problem.problem_key)
            : contentQuery.eq('problem_lc', problem.problem_lc)

        const { data: content, error: contentError } = await contentFilter.maybeSingle()
        if (contentError) {
          throw contentError
        }

        if (cancelled) {
          return
        }

        setForm((current) => ({
          ...current,
          ...contentToFormFields(content, track),
        }))

        if (track === 'sql' && problem.problem_key) {
          const [{ data: spec }, { data: fixtures }, { data: refSolution }] = await Promise.all([
            supabase.from('sql_problem_specs').select('*').eq('problem_key', problem.problem_key).maybeSingle(),
            supabase.from('sql_problem_fixtures').select('*').eq('problem_key', problem.problem_key).order('sort_order'),
            supabase.from('sql_problem_reference_solutions').select('*').eq('problem_key', problem.problem_key).maybeSingle(),
          ])

          if (cancelled) {
            return
          }

          setForm((current) => ({
            ...current,
            dialect_original: spec?.dialect_original || current.dialect_original,
            dialect_runtime: spec?.dialect_runtime || current.dialect_runtime,
            submission_kind: spec?.submission_kind || current.submission_kind,
            result_mode: spec?.result_mode || current.result_mode,
            sql_notes: spec?.notes || current.sql_notes,
            reference_sql_original: refSolution?.reference_sql_original || current.reference_sql_original,
            reference_sql_runtime: refSolution?.reference_sql_runtime || current.reference_sql_runtime,
            fixtures:
              Array.isArray(fixtures) && fixtures.length > 0
                ? fixtures.map((fixture) => ({
                    fixture_key: fixture.fixture_key,
                    label: fixture.label,
                    is_public: Boolean(fixture.is_public),
                    setup_sql: fixture.setup_sql || '',
                    postcheck_sql: fixture.postcheck_sql || '',
                    expected_columns_text: JSON.stringify(fixture.expected_columns ?? [], null, 2),
                    expected_rows_text: JSON.stringify(fixture.expected_rows ?? [], null, 2),
                    comparison_mode: fixture.comparison_mode || 'unordered_multiset',
                    order_required: Boolean(fixture.order_required),
                    notes: fixture.notes || '',
                  }))
                : current.fixtures,
          }))
        }
      } catch {
        // no-op, keep base form
      } finally {
        if (!cancelled) {
          setContentLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, problem])

  const title = mode === 'edit' ? 'Edit Problem' : 'Add Problem'

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const setTrack = (value) => {
    const nextTrack = value
    const nextChoices = defaultPhaseChoicesForTrack(nextTrack, phaseOptions)
    const nextDefaults = buildDefaultForm(nextTrack, nextChoices)
    setTrackKey(nextTrack)
    setShowCompanion(false)
    setForm((current) => ({
      ...nextDefaults,
      title: current.title,
      slug: current.slug,
      difficulty: current.difficulty,
      tier: current.tier,
      study_order: current.study_order,
      source_platform: current.source_platform,
      source_problem_id: current.source_problem_id,
      source_url: current.source_url,
      canonical_source_url: current.canonical_source_url,
      faang_verification: current.faang_verification,
      inclusion_rationale: current.inclusion_rationale,
      companies: current.companies,
      tags: current.tags,
      statement: current.statement,
      phase_name: nextChoices[0]?.name || nextDefaults.phase_name,
    }))
  }

  const setPhase = (value) => {
    const numericValue = Number(value)
    setForm((current) => ({
      ...current,
      phase: numericValue,
      phase_name: phaseLabelFor(activePhaseChoices, numericValue) || current.phase_name,
    }))
  }

  const updateExample = (index, key, value) => {
    setForm((current) => ({
      ...current,
      examples: current.examples.map((example, exampleIndex) =>
        exampleIndex === index ? { ...example, [key]: value } : example,
      ),
    }))
  }

  const addExample = () => {
    setForm((current) => ({ ...current, examples: [...current.examples, createEmptyExample()] }))
  }

  const removeExample = (index) => {
    setForm((current) => {
      const next = current.examples.filter((_, exampleIndex) => exampleIndex !== index)
      return { ...current, examples: next.length > 0 ? next : [createEmptyExample()] }
    })
  }

  const updateSeedTestCase = (index, key, value) => {
    setForm((current) => ({
      ...current,
      seed_test_cases: current.seed_test_cases.map((testCase, testCaseIndex) =>
        testCaseIndex === index ? { ...testCase, [key]: value } : testCase,
      ),
    }))
  }

  const addSeedTestCase = () => {
    setForm((current) => ({ ...current, seed_test_cases: [...current.seed_test_cases, createEmptyTestCase()] }))
  }

  const removeSeedTestCase = (index) => {
    setForm((current) => {
      const next = current.seed_test_cases.filter((_, testCaseIndex) => testCaseIndex !== index)
      return { ...current, seed_test_cases: next.length > 0 ? next : [createEmptyTestCase()] }
    })
  }

  const updateFixture = (index, key, value) => {
    setForm((current) => ({
      ...current,
      fixtures: current.fixtures.map((fixture, fixtureIndex) =>
        fixtureIndex === index ? { ...fixture, [key]: value } : fixture,
      ),
    }))
  }

  const addFixture = () => {
    setForm((current) => ({ ...current, fixtures: [...current.fixtures, createEmptyFixture()] }))
  }

  const removeFixture = (index) => {
    setForm((current) => {
      const next = current.fixtures.filter((_, fixtureIndex) => fixtureIndex !== index)
      return { ...current, fixtures: next.length > 0 ? next : [createEmptyFixture()] }
    })
  }

  const problemKeyPreview = useMemo(
    () =>
      buildProblemKey({
        trackKey: form.track_key,
        problemLc: numberOrNull(form.problem_lc),
        sourcePlatform: form.source_platform,
        sourceProblemId: form.source_problem_id,
        slug: form.slug,
        title: form.title,
      }),
    [form],
  )

  const handleSubmit = async (event) => {
    event.preventDefault()
    await onSave?.(parseProblemPayload(form, showCompanion, mode))
  }

  return (
    <Modal open={open} title={title} onClose={onClose} widthClass="max-w-6xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Catalog</p>
            <p className="mt-0.5 text-[11px] text-text-muted">One problem per row. DSA companions stay optional relationships. SQL uses fixtures/specs.</p>
          </div>
          {contentLoading ? <p className="text-[11px] text-text-muted">Loading content…</p> : null}
        </div>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Field label="Track">
            <select
              value={form.track_key}
              onChange={(event) => setTrack(event.target.value)}
              className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
            >
              {TRACK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title *">
            <Input value={form.title} required onChange={(event) => setField('title', event.target.value)} />
          </Field>
          <Field label={form.track_key === 'sql' ? 'Source ID / Slug' : 'LC # *'}>
            <Input
              type={form.track_key === 'sql' ? 'text' : 'number'}
              value={form.track_key === 'sql' ? form.source_problem_id : form.problem_lc}
              required={form.track_key === 'dsa'}
              onChange={(event) => setField(form.track_key === 'sql' ? 'source_problem_id' : 'problem_lc', event.target.value)}
            />
          </Field>
          <Field label="Difficulty">
            <Input value={form.difficulty} onChange={(event) => setField('difficulty', event.target.value)} />
          </Field>
          <Field label="Tier">
            <select
              value={form.tier}
              onChange={(event) => setField('tier', event.target.value)}
              className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
            >
              <option value={1}>Tier 1</option>
              <option value={2}>Tier 2</option>
              <option value={3}>Tier 3</option>
            </select>
          </Field>
        </section>

        <section className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <Field label="Phase / Module">
            <PhaseSelect value={form.phase} onChange={setPhase} options={activePhaseChoices} />
          </Field>
          <Field label="Order In Phase">
            <Input type="number" value={form.phase_order} required onChange={(event) => setField('phase_order', event.target.value)} />
          </Field>
          <Field label="Study Order">
            <Input type="number" value={form.study_order} onChange={(event) => setField('study_order', event.target.value)} />
          </Field>
          <Field label="Slug">
            <Input value={form.slug} onChange={(event) => setField('slug', event.target.value)} />
          </Field>
          <Field label="Problem Key Preview">
            <Input value={problemKeyPreview} readOnly />
          </Field>
        </section>

        <section className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Field label="Source Platform">
            <Input value={form.source_platform} onChange={(event) => setField('source_platform', event.target.value)} />
          </Field>
          <Field label="Canonical Source URL">
            <Input value={form.canonical_source_url} onChange={(event) => setField('canonical_source_url', event.target.value)} />
          </Field>
          <Field label="Original Source URL">
            <Input value={form.source_url} onChange={(event) => setField('source_url', event.target.value)} />
          </Field>
          <Field label="Category / Pattern">
            <Input value={form.category} onChange={(event) => setField('category', event.target.value)} />
          </Field>
        </section>

        <section className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Field label="FAANG Verification / Why It Matters">
            <TextArea value={form.faang_verification} onChange={(event) => setField('faang_verification', event.target.value)} rows={3} className="leading-6" />
          </Field>
          <Field label="Inclusion Rationale">
            <TextArea value={form.inclusion_rationale} onChange={(event) => setField('inclusion_rationale', event.target.value)} rows={3} className="leading-6" />
          </Field>
        </section>

        <section className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Field label="Tags">
            <Input value={form.tags} onChange={(event) => setField('tags', event.target.value)} placeholder="window, joins, hashing" />
          </Field>
          <Field label="Companies (comma separated)">
            <Input value={form.companies} onChange={(event) => setField('companies', event.target.value)} />
          </Field>
          {form.track_key === 'dsa' ? (
            <Field label="LeetCode URL">
              <Input value={form.leetcode_url} onChange={(event) => setField('leetcode_url', event.target.value)} />
            </Field>
          ) : (
            <Field label="Dialect Runtime">
              <Input value={form.dialect_runtime} onChange={(event) => setField('dialect_runtime', event.target.value)} />
            </Field>
          )}
        </section>

        {form.track_key === 'dsa' ? (
          <section className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field label="NeetCode URL">
              <Input value={form.neetcode_url} onChange={(event) => setField('neetcode_url', event.target.value)} />
            </Field>
            <Field label="Entry Point">
              <Input value={form.entry_point} onChange={(event) => setField('entry_point', event.target.value)} placeholder="Solution().containsDuplicate" />
            </Field>
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Field label="Dialect Original">
              <Input value={form.dialect_original} onChange={(event) => setField('dialect_original', event.target.value)} />
            </Field>
            <Field label="Submission Kind">
              <select
                value={form.submission_kind}
                onChange={(event) => setField('submission_kind', event.target.value)}
                className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
              >
                {SQL_SUBMISSION_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Result Mode">
              <select
                value={form.result_mode}
                onChange={(event) => setField('result_mode', event.target.value)}
                className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
              >
                {SQL_RESULT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="SQL Notes">
              <Input value={form.sql_notes} onChange={(event) => setField('sql_notes', event.target.value)} />
            </Field>
          </section>
        )}

        <section className="space-y-3 border border-border-subtle bg-base p-3">
          <SectionTitle
            title="Workspace Metadata"
            detail={
              form.track_key === 'sql'
                ? 'Statement, starter SQL, schema, examples, and requirements render from this payload.'
                : 'Statement, starter snippet, examples, and editor/runtime hints render from this payload.'
            }
          />
          <Field label="Statement">
            <TextArea value={form.statement} onChange={(event) => setField('statement', event.target.value)} rows={10} className="min-h-[220px] leading-6" />
          </Field>
          <Field label={form.track_key === 'sql' ? 'Starter SQL' : 'Starter Code'}>
            <TextArea value={form.starter_snippet} onChange={(event) => setField('starter_snippet', event.target.value)} rows={10} className="min-h-[220px] font-mono leading-6" />
          </Field>

          {form.track_key === 'sql' ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Field label="Schema (JSON array)">
                <TextArea
                  value={form.sql_schema_text}
                  onChange={(event) => setField('sql_schema_text', event.target.value)}
                  rows={8}
                  className="min-h-[220px] font-mono leading-6"
                />
              </Field>
              <Field label="Examples (JSON array)">
                <TextArea
                  value={form.sql_examples_text}
                  onChange={(event) => setField('sql_examples_text', event.target.value)}
                  rows={8}
                  className="min-h-[220px] font-mono leading-6"
                />
              </Field>
              <Field label="Requirements (JSON array)">
                <TextArea
                  value={form.sql_requirements_text}
                  onChange={(event) => setField('sql_requirements_text', event.target.value)}
                  rows={6}
                  className="min-h-[180px] font-mono leading-6 md:col-span-2"
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-2">
              <SectionTitle
                title="Examples"
                detail="Structured examples render directly in the problem pane."
                action={<RowActionButton onClick={addExample} icon={<Plus size={12} />} label="Add" />}
              />
              <div className="space-y-2">
                {form.examples.map((example, index) => (
                  <div key={`example-row-${index}`} className="space-y-2 border border-border-subtle bg-surface p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Example {index + 1}</p>
                      <RowActionButton onClick={() => removeExample(index)} icon={<Trash2 size={12} />} label="Remove" tone="danger" disabled={form.examples.length === 1} />
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <Field label="Input">
                        <TextArea value={example.input} onChange={(event) => updateExample(index, 'input', event.target.value)} rows={4} className="font-mono leading-6" />
                      </Field>
                      <Field label="Output">
                        <TextArea value={example.output} onChange={(event) => updateExample(index, 'output', event.target.value)} rows={4} className="font-mono leading-6" />
                      </Field>
                    </div>
                    <Field label="Explanation">
                      <TextArea value={example.explanation} onChange={(event) => updateExample(index, 'explanation', event.target.value)} rows={3} className="leading-6" />
                    </Field>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {form.track_key === 'dsa' ? (
          <>
            {mode === 'create' ? (
              <section className="space-y-2 border border-border-subtle bg-base p-3">
                <SectionTitle
                  title="Initial Test Cases"
                  detail="Seed runnable cases on creation. You can still refine them later from the test-case editor."
                  action={<RowActionButton onClick={addSeedTestCase} icon={<Plus size={12} />} label="Add" />}
                />
                <div className="space-y-2">
                  {form.seed_test_cases.map((testCase, index) => (
                    <div key={`seed-test-${index}`} className="space-y-2 border border-border-subtle bg-surface p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Test {index + 1}</p>
                        <RowActionButton onClick={() => removeSeedTestCase(index)} icon={<Trash2 size={12} />} label="Remove" tone="danger" disabled={form.seed_test_cases.length === 1} />
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Field label="Input">
                          <TextArea value={testCase.input_text} onChange={(event) => updateSeedTestCase(index, 'input_text', event.target.value)} rows={4} className="font-mono leading-6" />
                        </Field>
                        <Field label="Expected Output">
                          <TextArea value={testCase.expected_output} onChange={(event) => updateSeedTestCase(index, 'expected_output', event.target.value)} rows={4} className="font-mono leading-6" />
                        </Field>
                      </div>
                      <Field label="Notes">
                        <Input value={testCase.notes} onChange={(event) => updateSeedTestCase(index, 'notes', event.target.value)} />
                      </Field>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-2 border border-border-subtle bg-base p-3">
              <SectionTitle
                title="Companion Link"
                detail="Optional DSA-only relationship. This is not the row shape anymore."
                action={
                  <button
                    type="button"
                    onClick={() => setShowCompanion((current) => !current)}
                    className={`h-7 border px-2 text-[11px] ${showCompanion ? 'border-accent text-accent' : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent'}`}
                  >
                    {showCompanion ? 'Hide' : 'Add'}
                  </button>
                }
              />
              {showCompanion ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Field label="Companion LC #">
                    <Input type="number" value={form.companion_lc} onChange={(event) => setField('companion_lc', event.target.value)} />
                  </Field>
                  <Field label="Link Label">
                    <Input value={form.companion_label} onChange={(event) => setField('companion_label', event.target.value)} placeholder="Related follow-up" />
                  </Field>
                  <Field label="Notes">
                    <Input value={form.companion_notes} onChange={(event) => setField('companion_notes', event.target.value)} />
                  </Field>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <section className="space-y-3 border border-border-subtle bg-base p-3">
            <SectionTitle
              title="SQL Fixtures"
              detail="Each fixture is one isolated setup and expected result. Long SQL should scroll inside the editor, never overflow."
              action={<RowActionButton onClick={addFixture} icon={<Plus size={12} />} label="Add" />}
            />
            <div className="space-y-2">
              {form.fixtures.map((fixture, index) => (
                <div key={`fixture-${index}`} className="space-y-2 border border-border-subtle bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Fixture {index + 1}</p>
                    <RowActionButton onClick={() => removeFixture(index)} icon={<Trash2 size={12} />} label="Remove" tone="danger" disabled={form.fixtures.length === 1} />
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <Field label="Fixture Key">
                      <Input value={fixture.fixture_key} onChange={(event) => updateFixture(index, 'fixture_key', event.target.value)} />
                    </Field>
                    <Field label="Label">
                      <Input value={fixture.label} onChange={(event) => updateFixture(index, 'label', event.target.value)} />
                    </Field>
                    <Field label="Comparison">
                      <select
                        value={fixture.comparison_mode}
                        onChange={(event) => updateFixture(index, 'comparison_mode', event.target.value)}
                        className="h-8 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
                      >
                        {SQL_COMPARISON_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="flex items-end gap-3 pb-1">
                      <label className="flex items-center gap-2 text-[11px] text-text-primary">
                        <input type="checkbox" checked={fixture.is_public} onChange={(event) => updateFixture(index, 'is_public', event.target.checked)} />
                        Public
                      </label>
                      <label className="flex items-center gap-2 text-[11px] text-text-primary">
                        <input type="checkbox" checked={fixture.order_required} onChange={(event) => updateFixture(index, 'order_required', event.target.checked)} />
                        Ordered
                      </label>
                    </div>
                  </div>
                  <Field label="Setup SQL">
                    <TextArea value={fixture.setup_sql} onChange={(event) => updateFixture(index, 'setup_sql', event.target.value)} rows={6} className="max-h-56 overflow-auto font-mono leading-6" />
                  </Field>
                  <Field label="Postcheck SQL">
                    <TextArea value={fixture.postcheck_sql} onChange={(event) => updateFixture(index, 'postcheck_sql', event.target.value)} rows={4} className="max-h-40 overflow-auto font-mono leading-6" />
                  </Field>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Field label="Expected Columns (JSON array)">
                      <TextArea value={fixture.expected_columns_text} onChange={(event) => updateFixture(index, 'expected_columns_text', event.target.value)} rows={5} className="max-h-48 overflow-auto font-mono leading-6" />
                    </Field>
                    <Field label="Expected Rows (JSON array)">
                      <TextArea value={fixture.expected_rows_text} onChange={(event) => updateFixture(index, 'expected_rows_text', event.target.value)} rows={5} className="max-h-48 overflow-auto font-mono leading-6" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Field label="Reference SQL (Original)">
                <TextArea value={form.reference_sql_original} onChange={(event) => setField('reference_sql_original', event.target.value)} rows={6} className="max-h-56 overflow-auto font-mono leading-6" />
              </Field>
              <Field label="Reference SQL (Runtime)">
                <TextArea value={form.reference_sql_runtime} onChange={(event) => setField('reference_sql_runtime', event.target.value)} rows={6} className="max-h-56 overflow-auto font-mono leading-6" />
              </Field>
            </div>
          </section>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
          <button type="button" onClick={onClose} className="h-8 border border-border-subtle px-3 text-xs text-text-muted hover:border-accent hover:text-accent">
            Cancel
          </button>
          <button type="submit" disabled={saving || contentLoading} className="h-8 border border-accent bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50">
            {saving ? 'Saving…' : contentLoading ? 'Loading…' : mode === 'edit' ? 'Save Changes' : 'Create Problem'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
