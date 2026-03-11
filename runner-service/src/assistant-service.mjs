import { decryptSecret, encryptSecret } from './assistant-crypto.mjs'
import { generateStructuredJson } from './assistant-models.mjs'
import { runnerConfig } from './config.mjs'

const ASSISTANT_ROLE = 'Practicer AI'
const DEFAULT_THREAD_TITLE = 'New chat'
const MAX_MESSAGE_CHARS = 6000
const MAX_EDITOR_CHARS = 30000
const MAX_NOTE_CHARS = 18000
const MAX_STDOUT_CHARS = 6000
const MAX_RESULT_ROWS = 20
const MAX_THREAD_CONTEXT_MESSAGES = 10
const PLATFORM_PROVIDER = 'platform'
const USER_KEY_PROVIDER = 'user_key'

const VISIBLE_INTENTS = new Set([
  'explain',
  'hint',
  'debug',
  'review',
  'optimize',
  'generate_edge_cases',
  'reveal_full_solution',
  'general',
])

const PRO_INTENTS = new Set(['optimize', 'reveal_full_solution'])

function nowIso() {
  return new Date().toISOString()
}

function clampText(value, maxLength) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}\n...`
}

function toSafeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeIntent(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
  return VISIBLE_INTENTS.has(normalized) ? normalized : 'general'
}

function normalizeProviderMode(value) {
  return value === USER_KEY_PROVIDER ? USER_KEY_PROVIDER : PLATFORM_PROVIDER
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizePromptSuggestions(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function normalizeContentBlock(block, index) {
  const kind = String(block?.kind || '').trim().toLowerCase()
  const heading = clampText(block?.heading || '', 120)

  if (kind === 'code' || kind === 'sql') {
    const code = String(block?.code || block?.text || '').trim()
    if (!code) {
      return null
    }

    return {
      kind,
      heading,
      code,
      language: String(block?.language || (kind === 'sql' ? 'sql' : 'python')).trim() || 'text',
      copy_value: String(block?.copy_value || code),
      id: `block-${index}`,
    }
  }

  if (kind === 'bullets' || kind === 'checklist') {
    const items = Array.isArray(block?.items)
      ? block.items.map((item) => clampText(item, 400)).filter(Boolean).slice(0, 12)
      : []

    if (items.length === 0) {
      return null
    }

    return {
      kind,
      heading,
      items,
      copy_value: String(block?.copy_value || items.map((item) => `- ${item}`).join('\n')),
      id: `block-${index}`,
    }
  }

  const text = clampText(block?.text || block?.message || '', 4000)
  if (!text) {
    return null
  }

  return {
    kind: ['warning', 'result_explanation'].includes(kind) ? kind : 'text',
    heading,
    text,
    copy_value: String(block?.copy_value || text),
    id: `block-${index}`,
  }
}

function normalizeAssistantPayload(payload, fallbackMessage = '') {
  const title = clampText(payload?.title || 'Practicer AI', 140) || 'Practicer AI'
  const summary = clampText(payload?.summary || fallbackMessage || '', 1500)
  const blocks = Array.isArray(payload?.blocks)
    ? payload.blocks.map((block, index) => normalizeContentBlock(block, index)).filter(Boolean)
    : []

  if (blocks.length === 0) {
    blocks.push({
      kind: 'text',
      heading: '',
      text: summary || fallbackMessage || 'I could not format a structured answer for this turn.',
      copy_value: summary || fallbackMessage || 'I could not format a structured answer for this turn.',
      id: 'block-0',
    })
  }

  return {
    title,
    summary,
    blocks,
    suggested_prompts: normalizePromptSuggestions(payload?.suggested_prompts),
    usage: payload?.usage && typeof payload.usage === 'object' ? payload.usage : null,
  }
}

function getProviderBadge(providerMode) {
  return providerMode === USER_KEY_PROVIDER ? 'Your Gemini Key' : 'Practicer AI'
}

function summarizeSchema(schema) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return []
  }

  return schema.slice(0, 4).map((table) => ({
    table_name: String(table?.table_name || table?.name || '').trim(),
    columns: Array.isArray(table?.columns)
      ? table.columns.slice(0, 12).map((column) => ({
          name: String(column?.name || '').trim(),
          type: String(column?.type || column?.data_type || '').trim(),
        }))
      : [],
  }))
}

function summarizeExamples(presentation) {
  const examples = Array.isArray(presentation?.examples) ? presentation.examples : []
  return examples.slice(0, 3).map((example, index) => ({
    label: String(example?.label || `Example ${index + 1}`),
    input: clampText(example?.input || example?.input_text || '', 800),
    output: clampText(example?.output || example?.output_text || '', 800),
    explanation: clampText(example?.explanation || '', 1200),
  }))
}

function summarizeRequirements(presentation) {
  const requirements = Array.isArray(presentation?.requirements) ? presentation.requirements : []
  return requirements.map((item) => clampText(item, 240)).filter(Boolean).slice(0, 12)
}

function summarizeConstraints(presentation, contentRow) {
  if (Array.isArray(presentation?.constraints) && presentation.constraints.length > 0) {
    return presentation.constraints.map((item) => clampText(item, 240)).filter(Boolean).slice(0, 12)
  }

  return clampText(contentRow?.constraints_text || '', 1200)
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function summarizeSqlResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      columns: [],
      rows: [],
      row_count: 0,
    }
  }

  const columns = Array.isArray(value.columns) ? value.columns.slice(0, 16) : []
  const rows = Array.isArray(value.rows) ? value.rows.slice(0, MAX_RESULT_ROWS) : []

  return {
    columns,
    rows,
    row_count: Array.isArray(value.rows) ? value.rows.length : 0,
  }
}

function summarizeSqlCase(caseResult) {
  if (!caseResult) {
    return null
  }

  return {
    id: String(caseResult.id || ''),
    label: String(caseResult.label || caseResult.id || '').trim(),
    passed: Boolean(caseResult.passed),
    message: clampText(caseResult.message || '', 400),
    error: clampText(caseResult.error || '', 500),
    output: summarizeSqlResult(caseResult.output),
    expected: summarizeSqlResult(caseResult.expected),
  }
}

function summarizeDsaCase(caseResult) {
  if (!caseResult) {
    return null
  }

  return {
    id: caseResult.id ?? null,
    passed: Boolean(caseResult.passed),
    input: clampText(JSON.stringify(caseResult.input ?? '', null, 2), 1200),
    expected: clampText(JSON.stringify(caseResult.expected ?? '', null, 2), 1200),
    output: clampText(JSON.stringify(caseResult.output ?? '', null, 2), 1200),
    error: clampText(caseResult.error || '', 600),
    message: clampText(caseResult.message || '', 300),
  }
}

function makeRunSummary(runRow) {
  const mode = String(runRow?.runner_meta?.mode || '').trim().toLowerCase()
  const status = String(runRow?.status || '').trim().toLowerCase()
  const testsPassed = toSafeNumber(runRow?.tests_passed)
  const testsTotal = toSafeNumber(runRow?.tests_total)

  return {
    id: runRow?.id ?? null,
    mode,
    status,
    tests_passed: testsPassed,
    tests_total: testsTotal,
    runtime_ms: toSafeNumber(runRow?.runtime_ms),
    memory_kb: toSafeNumber(runRow?.memory_kb),
    created_at: runRow?.created_at || null,
    stderr: clampText(runRow?.stderr || runRow?.compile_output || '', 1200),
  }
}

function getRecentMessagesForPrompt(messages) {
  const recent = messages.slice(-MAX_THREAD_CONTEXT_MESSAGES)
  return recent.map((message) => ({
    role: message.role,
    intent: message.intent,
    status: message.status,
    content: message.role === 'assistant' ? message.content?.summary || message.content?.title || '' : message.content?.text || '',
    created_at: message.created_at,
  }))
}

function buildAssistantSystemInstruction(trackKey) {
  return [
    `You are ${ASSISTANT_ROLE}, a problem-scoped assistant inside Practicer.`,
    'Return valid JSON only. Do not wrap the response in markdown code fences.',
    'The JSON object must have these keys: title, summary, blocks, suggested_prompts.',
    'blocks must be an array of objects with kind plus one of text/items/code.',
    'Allowed block kinds: text, bullets, code, sql, warning, checklist, result_explanation.',
    'Keep answers concise, structured, and directly useful inside an interview practice workspace.',
    'Do not mention hidden tests or hidden fixtures.',
    trackKey === 'sql'
      ? 'When you provide query fixes, use PostgreSQL 14 SQL only.'
      : 'When you provide code, use Python only.',
    'Do not reveal a full solution unless the intent explicitly asks for reveal_full_solution.',
    'Prefer debugging the user’s current work over giving a replacement from scratch.',
  ].join('\n')
}

function buildAssistantUserPrompt({ intent, message, context }) {
  return [
    `Intent: ${intent}`,
    'User request:',
    clampText(message, MAX_MESSAGE_CHARS),
    '',
    'Structured context JSON:',
    JSON.stringify(context, null, 2),
    '',
    'Respond with JSON only.',
  ].join('\n')
}

function buildFallbackAssistantPayload({ intent, message, context }) {
  const summary = intent === 'debug'
    ? 'I could not complete the model turn, but the latest run context is attached and ready for another try.'
    : 'I could not complete the model turn. Try again or reduce the attached context.'

  return normalizeAssistantPayload({
    title: 'Assistant unavailable',
    summary,
    blocks: [
      {
        kind: 'warning',
        heading: 'Request kept in context',
        text: `Intent: ${intent}\nMessage: ${clampText(message, 800)}`,
      },
      {
        kind: 'text',
        heading: 'Attached context',
        text: clampText(JSON.stringify(context, null, 2), 2400),
      },
    ],
    suggested_prompts: ['Try again', 'Use a smaller hint', 'Debug only the latest failure'],
  })
}

async function listPublicSqlFixtures(supabase, problemKey) {
  const { data, error } = await supabase
    .from('sql_problem_fixtures')
    .select('fixture_key,label,is_public,sort_order,setup_sql')
    .eq('problem_key', problemKey)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

async function buildProblemContext({ supabase, problemKey, trackKey }) {
  const [problemResult, contentResult, sqlSpecResult, sqlFixtures] = await Promise.all([
    supabase.from('v_study_problems').select('*').eq('problem_key', problemKey).maybeSingle(),
    supabase.from('problem_content').select('*').eq('problem_key', problemKey).maybeSingle(),
    trackKey === 'sql'
      ? supabase.from('sql_problem_specs').select('*').eq('problem_key', problemKey).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    trackKey === 'sql' ? listPublicSqlFixtures(supabase, problemKey) : Promise.resolve([]),
  ])

  if (problemResult.error) {
    throw problemResult.error
  }
  if (contentResult.error) {
    throw contentResult.error
  }
  if (sqlSpecResult?.error) {
    throw sqlSpecResult.error
  }

  const problemRow = problemResult.data || {}
  const contentRow = contentResult.data || {}
  const presentation =
    contentRow?.presentation && typeof contentRow.presentation === 'object' && !Array.isArray(contentRow.presentation)
      ? contentRow.presentation
      : {}

  return {
    identity: {
      problem_key: problemKey,
      track_key: trackKey,
      title: String(problemRow.title || contentRow.title || '').trim(),
      tier: problemRow.tier ?? null,
      phase_name: String(problemRow.phase_name || '').trim(),
      category: String(problemRow.category || '').trim(),
      source_platform: String(problemRow.source_platform || '').trim(),
      source_problem_id: String(problemRow.source_problem_id || '').trim(),
    },
    statement: clampText(
      presentation.statement || contentRow.statement_clean || contentRow.problem_description || '',
      9000,
    ),
    examples: summarizeExamples(presentation),
    constraints: summarizeConstraints(presentation, contentRow),
    requirements: summarizeRequirements(presentation),
    schema: trackKey === 'sql' ? summarizeSchema(presentation.schema) : [],
    tags: Array.isArray(contentRow.tags) ? contentRow.tags.slice(0, 12) : [],
    editor_language: String(contentRow.editor_language || (trackKey === 'sql' ? 'sql' : 'python')).trim(),
    runtime_kind: String(contentRow.runtime_kind || '').trim(),
    sql_submission_kind: sqlSpecResult?.data?.submission_kind || null,
    public_fixtures:
      trackKey === 'sql'
        ? sqlFixtures
            .filter((fixture) => fixture.is_public)
            .map((fixture) => ({
              fixture_key: String(fixture.fixture_key || ''),
              label: String(fixture.label || fixture.fixture_key || '').trim(),
              setup_sql: clampText(fixture.setup_sql || '', 6000),
            }))
            .slice(0, 4)
        : [],
  }
}

async function resolveRunContext({
  supabase,
  userKey,
  problemKey,
  trackKey,
  selectedRunId,
  selectedCaseIds,
  selectedFixtureId,
  includeStdout,
}) {
  let query = supabase.from('code_runs').select('*').eq('user_key', userKey).eq('problem_key', problemKey).order('created_at', { ascending: false }).limit(1)
  if (selectedRunId) {
    query = supabase.from('code_runs').select('*').eq('id', selectedRunId).eq('user_key', userKey).eq('problem_key', problemKey).maybeSingle()
  } else {
    query = query.maybeSingle()
  }

  const { data: runRow, error } = await query
  if (error) {
    throw error
  }

  if (!runRow) {
    return null
  }

  const summary = makeRunSummary(runRow)

  if (trackKey === 'sql') {
    const fixtures = await listPublicSqlFixtures(supabase, problemKey)
    const publicFixtureIds = new Set(fixtures.filter((fixture) => fixture.is_public).map((fixture) => String(fixture.fixture_key)))
    const runCases = Array.isArray(runRow?.verdict?.cases) ? runRow.verdict.cases : []
    const chosenFixtureId = String(selectedFixtureId || '').trim()
    const selectedCase =
      chosenFixtureId && publicFixtureIds.has(chosenFixtureId)
        ? runCases.find((caseResult) => String(caseResult.id) === chosenFixtureId)
        : null

    return {
      ...summary,
      fixture_key: chosenFixtureId || null,
      public_case: summarizeSqlCase(selectedCase),
      visible_checks: runCases
        .filter((caseResult) => publicFixtureIds.has(String(caseResult.id)))
        .slice(0, 4)
        .map((caseResult) => ({
          id: String(caseResult.id || ''),
          passed: Boolean(caseResult.passed),
          message: clampText(caseResult.message || '', 240),
        })),
    }
  }

  const runCases = Array.isArray(runRow?.verdict?.cases) ? runRow.verdict.cases : []
  const focusSet = new Set((Array.isArray(selectedCaseIds) ? selectedCaseIds : []).map((item) => Number(item)))
  const failedCases = runCases.filter((caseResult) => !caseResult?.passed)

  return {
    ...summary,
    stdout: includeStdout ? clampText(runRow?.stdout || '', MAX_STDOUT_CHARS) : '',
    first_failed_case: summarizeDsaCase(failedCases[0]),
    selected_cases:
      focusSet.size > 0
        ? runCases.filter((caseResult) => focusSet.has(Number(caseResult.id))).slice(0, 4).map(summarizeDsaCase)
        : [],
    failed_count: failedCases.length,
  }
}

async function resolveNoteContext({ supabase, userKey, noteId, noteSnapshot }) {
  if (noteSnapshot && typeof noteSnapshot === 'object') {
    return {
      id: noteId ?? null,
      content: clampText(JSON.stringify(noteSnapshot, null, 2), MAX_NOTE_CHARS),
    }
  }

  if (!noteId) {
    return null
  }

  const { data, error } = await supabase
    .from('notes')
    .select('id,content')
    .eq('id', noteId)
    .eq('user_key', userKey)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    return null
  }

  return {
    id: data.id,
    content: clampText(JSON.stringify(data.content || {}, null, 2), MAX_NOTE_CHARS),
  }
}

async function fetchThreadMessages(supabase, threadId, userKey) {
  const { data, error } = await supabase
    .from('assistant_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('user_key', userKey)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

async function ensureThreadOwnership(supabase, threadId, userKey) {
  const { data, error } = await supabase
    .from('assistant_threads')
    .select('*')
    .eq('id', threadId)
    .eq('user_key', userKey)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Assistant thread not found.')
  }

  return data
}

function determineModel({ intent, runContext, trackKey }) {
  if (
    PRO_INTENTS.has(intent) ||
    intent === 'debug' && (runContext?.status === 'error' || runContext?.stderr) ||
    trackKey === 'sql' && intent === 'review' && runContext?.public_case && !runContext.public_case.passed
  ) {
    return runnerConfig.vertexModelPro
  }

  return runnerConfig.vertexModelFlash
}

function determineBackgroundModel() {
  return runnerConfig.backgroundModelFlash25
}

async function resolveProviderConfig({ supabase, userKey, providerMode }) {
  if (providerMode !== USER_KEY_PROVIDER) {
    return {
      provider: 'vertex',
      mode: PLATFORM_PROVIDER,
      badge: getProviderBadge(PLATFORM_PROVIDER),
      apiKey: '',
    }
  }

  const { data, error } = await supabase
    .from('user_ai_credentials')
    .select('*')
    .eq('user_key', userKey)
    .eq('provider', 'gemini_api')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('No active Gemini API key found. Add one in Settings > AI or switch back to Practicer AI.')
  }

  return {
    provider: 'gemini_api',
    mode: USER_KEY_PROVIDER,
    badge: getProviderBadge(USER_KEY_PROVIDER),
    apiKey: decryptSecret(data),
  }
}

async function sumAssistantCosts({ supabase, userKey, providerMode, sinceIso }) {
  const provider = providerMode === USER_KEY_PROVIDER ? 'gemini_api' : 'vertex'
  const { data, error } = await supabase
    .from('assistant_messages')
    .select('estimated_cost_usd')
    .eq('user_key', userKey)
    .eq('provider', provider)
    .gte('created_at', sinceIso)

  if (error) {
    throw error
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0)
}

async function enforceSpendLimits({ supabase, userKey, providerMode }) {
  if (providerMode === USER_KEY_PROVIDER) {
    return
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()

  const [monthSpend, daySpend] = await Promise.all([
    sumAssistantCosts({ supabase, userKey, providerMode, sinceIso: monthStart }),
    sumAssistantCosts({ supabase, userKey, providerMode, sinceIso: dayStart }),
  ])

  if (monthSpend >= runnerConfig.assistantPlatformMonthlyHardCapUsd) {
    throw new Error('Practicer AI is temporarily unavailable because the monthly platform budget is exhausted.')
  }

  if (daySpend >= runnerConfig.assistantUserDailyHardCapUsd) {
    throw new Error('You have reached today’s Practicer AI limit. Try again tomorrow or switch to your own Gemini key.')
  }
}

async function maybeSummarizeThread({ supabase, thread, messages, providerConfig }) {
  if (messages.length < MAX_THREAD_CONTEXT_MESSAGES + 4) {
    return thread.rolling_summary || ''
  }

  const olderMessages = messages.slice(0, Math.max(0, messages.length - MAX_THREAD_CONTEXT_MESSAGES))
  const prompt = [
    'Summarize this assistant conversation for future turns.',
    'Return JSON with keys title and summary.',
    JSON.stringify(
      olderMessages.map((message) => ({
        role: message.role,
        intent: message.intent,
        summary: message.role === 'assistant' ? message.content?.summary || '' : message.content?.text || '',
      })),
      null,
      2,
    ),
  ].join('\n')

  try {
    const response = await generateStructuredJson({
      provider: 'vertex',
      model: determineBackgroundModel(),
      systemInstruction: 'Return valid JSON only with keys title and summary.',
      userPrompt: prompt,
      temperature: 0.2,
      maxOutputTokens: 512,
    })
    const parsed = parseJsonObject(response.text)
    const summary = clampText(parsed?.summary || '', 2000)
    if (!summary) {
      return thread.rolling_summary || ''
    }

    const { error } = await supabase
      .from('assistant_threads')
      .update({ rolling_summary: summary, updated_at: nowIso() })
      .eq('id', thread.id)
      .eq('user_key', thread.user_key)

    if (error) {
      throw error
    }

    return summary
  } catch {
    return thread.rolling_summary || ''
  }
}

async function maybeRetitleThread({ supabase, thread, messages, problemTitle }) {
  if (thread.title && thread.title !== DEFAULT_THREAD_TITLE) {
    return thread.title
  }

  const pair = messages.filter((message) => message.role !== 'system').slice(0, 2)
  if (pair.length < 2) {
    return thread.title || DEFAULT_THREAD_TITLE
  }

  const prompt = [
    'Write a short assistant thread title.',
    'Return JSON only with keys title and summary.',
    'Keep the title under 45 characters.',
    `Problem: ${problemTitle}`,
    JSON.stringify(
      pair.map((message) => ({
        role: message.role,
        text: message.role === 'assistant' ? message.content?.summary || '' : message.content?.text || '',
      })),
      null,
      2,
    ),
  ].join('\n')

  try {
    const response = await generateStructuredJson({
      provider: 'vertex',
      model: determineBackgroundModel(),
      systemInstruction: 'Return valid JSON only with keys title and summary.',
      userPrompt: prompt,
      temperature: 0.2,
      maxOutputTokens: 120,
    })
    const parsed = parseJsonObject(response.text)
    const nextTitle = clampText(parsed?.title || '', 45)
    if (!nextTitle) {
      return thread.title || DEFAULT_THREAD_TITLE
    }

    const { error } = await supabase
      .from('assistant_threads')
      .update({ title: nextTitle, updated_at: nowIso() })
      .eq('id', thread.id)
      .eq('user_key', thread.user_key)

    if (!error) {
      return nextTitle
    }
  } catch {
    // Ignore background failures.
  }

  return thread.title || DEFAULT_THREAD_TITLE
}

export async function authenticateAssistantRequest(req, supabase) {
  const authHeader = String(req.headers.authorization || '').trim()
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!tokenMatch) {
    throw new Error('Authorization header is required.')
  }

  const accessToken = tokenMatch[1].trim()
  if (!accessToken) {
    throw new Error('Authorization token is empty.')
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user?.id) {
    throw new Error('Invalid or expired session.')
  }

  const { data: appUser, error: userError } = await supabase
    .from('app_users')
    .select('user_key,auth_user_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (userError) {
    throw userError
  }

  if (!appUser?.user_key) {
    throw new Error('Authenticated user is not mapped to an app user.')
  }

  return {
    authUserId: authData.user.id,
    userKey: appUser.user_key,
    email: authData.user.email || '',
  }
}

export async function listAssistantThreads({ supabase, userKey, problemKey }) {
  const { data, error } = await supabase
    .from('assistant_threads')
    .select('*')
    .eq('user_key', userKey)
    .eq('problem_key', problemKey)
    .is('archived_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createAssistantThread({ supabase, userKey, problemKey, trackKey, title, providerMode }) {
  const payload = {
    user_key: userKey,
    problem_key: problemKey,
    track_key: trackKey === 'sql' ? 'sql' : 'dsa',
    title: clampText(title || DEFAULT_THREAD_TITLE, 80) || DEFAULT_THREAD_TITLE,
    provider_mode: normalizeProviderMode(providerMode),
  }

  const { data, error } = await supabase
    .from('assistant_threads')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function updateAssistantThread({ supabase, userKey, threadId, patch }) {
  const payload = {}

  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    payload.title = clampText(patch.title, 80) || DEFAULT_THREAD_TITLE
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'provider_mode')) {
    payload.provider_mode = normalizeProviderMode(patch.provider_mode)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'archived')) {
    payload.archived_at = patch.archived ? nowIso() : null
  }

  const { data, error } = await supabase
    .from('assistant_threads')
    .update(payload)
    .eq('id', threadId)
    .eq('user_key', userKey)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function listAssistantMessages({ supabase, userKey, threadId }) {
  await ensureThreadOwnership(supabase, threadId, userKey)
  return fetchThreadMessages(supabase, threadId, userKey)
}

export async function getAssistantCredentialSummary({ supabase, userKey }) {
  const { data, error } = await supabase
    .from('user_ai_credentials')
    .select('id,provider,masked_suffix,label,is_active,validated_at,last_error,updated_at')
    .eq('user_key', userKey)
    .eq('provider', 'gemini_api')
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function saveAssistantCredential({ supabase, userKey, apiKey, label = 'Gemini API key' }) {
  const trimmedKey = String(apiKey || '').trim()
  if (!trimmedKey) {
    throw new Error('Gemini API key is required.')
  }

  await generateStructuredJson({
    provider: 'gemini_api',
    model: runnerConfig.vertexModelFlash,
    apiKey: trimmedKey,
    systemInstruction: 'Return valid JSON only with keys title and summary.',
    userPrompt: 'Return {"title":"ok","summary":"validated"} as JSON.',
    temperature: 0,
    maxOutputTokens: 80,
  })

  const encrypted = encryptSecret(trimmedKey)
  const maskedSuffix = trimmedKey.slice(-6)

  const { error: disableError } = await supabase
    .from('user_ai_credentials')
    .update({ is_active: false, updated_at: nowIso() })
    .eq('user_key', userKey)
    .eq('provider', 'gemini_api')
    .eq('is_active', true)

  if (disableError) {
    throw disableError
  }

  const { data, error } = await supabase
    .from('user_ai_credentials')
    .insert({
      user_key: userKey,
      provider: 'gemini_api',
      ...encrypted,
      masked_suffix: maskedSuffix,
      label: clampText(label, 60) || 'Gemini API key',
      is_active: true,
      validated_at: nowIso(),
      last_error: null,
    })
    .select('id,provider,masked_suffix,label,is_active,validated_at,last_error,updated_at')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function deleteAssistantCredential({ supabase, userKey, credentialId }) {
  const { error } = await supabase
    .from('user_ai_credentials')
    .delete()
    .eq('id', credentialId)
    .eq('user_key', userKey)

  if (error) {
    throw error
  }

  return { ok: true }
}

export async function streamAssistantReply({
  supabase,
  userKey,
  threadId,
  message,
  intent,
  attachments,
  editorSnapshot,
  noteSnapshot,
  onEvent,
}) {
  const thread = await ensureThreadOwnership(supabase, threadId, userKey)
  const providerMode = normalizeProviderMode(attachments?.provider_mode || thread.provider_mode)

  await enforceSpendLimits({ supabase, userKey, providerMode })
  onEvent({ type: 'status', stage: 'context', message: 'Assembling workspace context…' })

  const trimmedMessage = clampText(message, MAX_MESSAGE_CHARS)
  if (!trimmedMessage) {
    throw new Error('Message is required.')
  }

  const problemContext = await buildProblemContext({
    supabase,
    problemKey: thread.problem_key,
    trackKey: thread.track_key,
  })

  const runContext = attachments?.include_latest_run
    ? await resolveRunContext({
        supabase,
        userKey,
        problemKey: thread.problem_key,
        trackKey: thread.track_key,
        selectedRunId: attachments?.selected_run_id,
        selectedCaseIds: attachments?.selected_case_ids,
        selectedFixtureId: attachments?.selected_fixture_id,
        includeStdout: Boolean(attachments?.include_stdout),
      })
    : null

  const noteContext = attachments?.include_note
    ? await resolveNoteContext({
        supabase,
        userKey,
        noteId: attachments?.note_id,
        noteSnapshot,
      })
    : null

  const messages = await fetchThreadMessages(supabase, threadId, userKey)
  const rollingSummary = await maybeSummarizeThread({
    supabase,
    thread,
    messages,
  })

  const context = {
    problem: problemContext,
    workspace: {
      provider_badge: getProviderBadge(providerMode),
      editor_text: attachments?.include_editor ? clampText(editorSnapshot, MAX_EDITOR_CHARS) : '',
      latest_run: runContext,
      note: noteContext,
      selected_fixture_id: attachments?.selected_fixture_id || null,
      selected_run_id: attachments?.selected_run_id || null,
      selected_case_ids: Array.isArray(attachments?.selected_case_ids) ? attachments.selected_case_ids : [],
    },
    conversation: {
      rolling_summary: rollingSummary,
      recent_messages: getRecentMessagesForPrompt(messages),
    },
  }

  const normalizedIntent = normalizeIntent(intent)
  const userMessagePayload = {
    text: trimmedMessage,
    attachments: {
      include_problem: Boolean(attachments?.include_problem),
      include_editor: Boolean(attachments?.include_editor),
      include_latest_run: Boolean(attachments?.include_latest_run),
      include_note: Boolean(attachments?.include_note),
      include_stdout: Boolean(attachments?.include_stdout),
      selected_case_ids: Array.isArray(attachments?.selected_case_ids) ? attachments.selected_case_ids : [],
      selected_fixture_id: attachments?.selected_fixture_id || null,
      selected_run_id: attachments?.selected_run_id || null,
      note_id: attachments?.note_id || null,
    },
  }

  const { data: userMessageRow, error: userInsertError } = await supabase
    .from('assistant_messages')
    .insert({
      thread_id: threadId,
      user_key: userKey,
      problem_key: thread.problem_key,
      role: 'user',
      intent: normalizedIntent,
      status: 'completed',
      content: userMessagePayload,
      context_snapshot: context,
      source_run_id: attachments?.selected_run_id || runContext?.id || null,
      source_note_id: attachments?.note_id || noteContext?.id || null,
    })
    .select('*')
    .single()

  if (userInsertError) {
    throw userInsertError
  }

  const { data: placeholderRow, error: placeholderError } = await supabase
    .from('assistant_messages')
    .insert({
      thread_id: threadId,
      user_key: userKey,
      problem_key: thread.problem_key,
      role: 'assistant',
      intent: normalizedIntent,
      status: 'streaming',
      content: {
        title: 'Thinking…',
        summary: '',
        blocks: [],
        suggested_prompts: [],
        usage: null,
      },
      context_snapshot: context,
      source_run_id: attachments?.selected_run_id || runContext?.id || null,
      source_note_id: attachments?.note_id || noteContext?.id || null,
    })
    .select('*')
    .single()

  if (placeholderError) {
    throw placeholderError
  }

  const startedAt = Date.now()
  onEvent({ type: 'status', stage: 'model', message: 'Calling model…', message_id: placeholderRow.id })

  try {
    const providerConfig = await resolveProviderConfig({ supabase, userKey, providerMode })
    const model = determineModel({
      intent: normalizedIntent,
      runContext,
      trackKey: thread.track_key,
    })

    const response = await generateStructuredJson({
      provider: providerConfig.provider,
      model,
      apiKey: providerConfig.apiKey,
      systemInstruction: buildAssistantSystemInstruction(thread.track_key),
      userPrompt: buildAssistantUserPrompt({
        intent: normalizedIntent,
        message: trimmedMessage,
        context,
      }),
      temperature: normalizedIntent === 'reveal_full_solution' ? 0.28 : 0.34,
      maxOutputTokens: normalizedIntent === 'reveal_full_solution' ? 4096 : 2048,
    })

    let parsed = parseJsonObject(response.text)
    if (!parsed) {
      const repair = await generateStructuredJson({
        provider: providerConfig.provider,
        model,
        apiKey: providerConfig.apiKey,
        systemInstruction: 'Repair the provided response into valid JSON only.',
        userPrompt: [
          'Return a valid JSON object with keys title, summary, blocks, suggested_prompts.',
          response.text,
        ].join('\n'),
        temperature: 0,
        maxOutputTokens: 2048,
      })
      parsed = parseJsonObject(repair.text)
    }

    const normalizedPayload = normalizeAssistantPayload(parsed, response.text)
    normalizedPayload.usage = {
      model,
      provider: providerConfig.provider,
      prompt_tokens: response.usage.promptTokens,
      output_tokens: response.usage.outputTokens,
      estimated_cost_usd: response.estimatedCostUsd,
      latency_ms: Date.now() - startedAt,
    }

    const { data: completedMessage, error: updateError } = await supabase
      .from('assistant_messages')
      .update({
        status: 'completed',
        content: normalizedPayload,
        model,
        provider: providerConfig.provider,
        prompt_tokens: response.usage.promptTokens,
        output_tokens: response.usage.outputTokens,
        estimated_cost_usd: response.estimatedCostUsd,
        latency_ms: Date.now() - startedAt,
      })
      .eq('id', placeholderRow.id)
      .eq('user_key', userKey)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    const nextTimestamp = nowIso()
    const { error: threadUpdateError } = await supabase
      .from('assistant_threads')
      .update({
        last_message_at: nextTimestamp,
        provider_mode: providerMode,
        updated_at: nextTimestamp,
      })
      .eq('id', threadId)
      .eq('user_key', userKey)

    if (threadUpdateError) {
      throw threadUpdateError
    }

    const refreshedMessages = [...messages, userMessageRow, completedMessage]
    const finalTitle = await maybeRetitleThread({
      supabase,
      thread: {
        ...thread,
        provider_mode: providerMode,
      },
      messages: refreshedMessages,
      problemTitle: problemContext.identity.title,
    })

    onEvent({
      type: 'message',
      message: {
        ...completedMessage,
        content: normalizedPayload,
      },
      thread: {
        ...thread,
        provider_mode: providerMode,
        title: finalTitle,
        last_message_at: nextTimestamp,
      },
    })
  } catch (error) {
    const fallbackPayload = buildFallbackAssistantPayload({
      intent: normalizedIntent,
      message: trimmedMessage,
      context,
    })

    const { data: erroredMessage, error: updateError } = await supabase
      .from('assistant_messages')
      .update({
        status: 'error',
        content: fallbackPayload,
        provider: providerMode === USER_KEY_PROVIDER ? 'gemini_api' : 'vertex',
        latency_ms: Date.now() - startedAt,
      })
      .eq('id', placeholderRow.id)
      .eq('user_key', userKey)
      .select('*')
      .single()

    if (updateError) {
      throw updateError
    }

    onEvent({
      type: 'message',
      message: erroredMessage,
      error: error instanceof Error ? error.message : 'Assistant request failed.',
      thread,
    })
  }
}
