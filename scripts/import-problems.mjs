import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(projectRoot, '..')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const values = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const splitIndex = line.indexOf('=')
    if (splitIndex <= 0) {
      continue
    }

    const key = line.slice(0, splitIndex).trim()
    let value = line.slice(splitIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }

  return values
}

function envValue(key) {
  if (process.env[key]) {
    return process.env[key]
  }

  const localEnv = loadDotEnv(path.join(projectRoot, '.env.local'))
  if (localEnv[key]) {
    return localEnv[key]
  }

  const baseEnv = loadDotEnv(path.join(projectRoot, '.env'))
  return baseEnv[key]
}

function toNullableText(value) {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function toCompanies(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0)
  }

  return []
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function buildPhaseMap(pairs) {
  const phases = Array.from(
    new Set(
      pairs
        .map((pair) => toNumber(pair.phase))
        .filter((phase) => Number.isFinite(phase)),
    ),
  ).sort((left, right) => left - right)

  return new Map(phases.map((phase, index) => [phase, index + 1]))
}

function loadPairs() {
  const dataPath = path.join(workspaceRoot, 'dsa-companions.json')
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found: ${dataPath}`)
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  const pairs = Array.isArray(raw?.problems) ? raw.problems : []
  if (pairs.length === 0) {
    throw new Error('No problems found in dsa-companions.json')
  }

  return pairs
}

function modulePayload(pair, phaseMap) {
  const legacyPhase = toNumber(pair.phase)
  const phase = phaseMap.get(legacyPhase)
  const phaseName = String(pair.phase_name ?? '').trim()
  if (!phase || !phaseName) {
    throw new Error(`Invalid phase metadata for pair ${JSON.stringify(pair).slice(0, 200)}`)
  }

  return {
    track_key: 'dsa',
    module_key: `phase-${phase}`,
    module_number: phase,
    name: phaseName,
    sort_order: phase,
    is_active: true,
  }
}

function problemPayload(node, pair, sourceType, phaseMap) {
  const lc = toNumber(node?.lc)
  if (!lc) {
    throw new Error(`Missing LC id for ${sourceType} node in phase ${pair.phase}`)
  }

  const mappedPhase = phaseMap.get(toNumber(pair.phase))
  if (!mappedPhase) {
    throw new Error(`Missing mapped phase for ${sourceType} LC ${lc}`)
  }

  return {
    problem_lc: lc,
    track_key: 'dsa',
    module_key: `phase-${mappedPhase}`,
    source_type: sourceType,
    title: String(node?.title ?? '').trim(),
    slug: toNullableText(node?.slug) ?? slugify(node?.title),
    difficulty: toNullableText(node?.difficulty),
    tier: toNumber(node?.tier) ?? (sourceType === 'companion' ? Math.min(3, (toNumber(pair?.tier) ?? 1) + 1) : toNumber(pair?.tier)),
    phase_order: toNumber(pair?.phase_order) ?? lc,
    category: sourceType === 'neetcode' ? toNullableText(node?.category) : toNullableText(node?.pattern_connection),
    companies: toCompanies(node?.companies),
    leetcode_url: toNullableText(node?.leetcode_url),
    neetcode_url: sourceType === 'neetcode' ? toNullableText(node?.neetcode_url) : null,
    curation_source: sourceType === 'neetcode' ? 'core' : 'companion_set',
    is_active: true,
    legacy_relation_label: sourceType === 'companion' ? toNullableText(node?.pattern_connection) : null,
    legacy_relation_notes: sourceType === 'companion' ? toNullableText(node?.why) : null,
  }
}

async function main() {
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const pairs = loadPairs()
  const phaseMap = buildPhaseMap(pairs)

  const moduleRows = new Map()
  const problemRows = []
  const relationRows = []

  for (const pair of pairs) {
    const module = modulePayload(pair, phaseMap)
    moduleRows.set(module.module_key, module)

    const nc = problemPayload(pair.neetcode, pair, 'neetcode', phaseMap)
    const cp = problemPayload(pair.companion, pair, 'companion', phaseMap)
    problemRows.push(nc, cp)

    relationRows.push({
      from_problem_lc: nc.problem_lc,
      to_problem_lc: cp.problem_lc,
      relationship_type: 'companion',
      label: cp.legacy_relation_label,
      notes: cp.legacy_relation_notes,
      sort_order: 1,
    })
    relationRows.push({
      from_problem_lc: cp.problem_lc,
      to_problem_lc: nc.problem_lc,
      relationship_type: 'companion',
      label: cp.legacy_relation_label,
      notes: cp.legacy_relation_notes,
      sort_order: 1,
    })
  }

  await supabase.from('study_tracks').upsert({ key: 'dsa', name: 'DSA', sort_order: 1, is_active: true }, { onConflict: 'key' })

  const { error: moduleError } = await supabase
    .from('study_modules')
    .upsert(Array.from(moduleRows.values()), { onConflict: 'track_key,module_key' })
  if (moduleError) {
    throw moduleError
  }

  const { data: modules, error: moduleFetchError } = await supabase
    .from('study_modules')
    .select('id,module_key')
    .eq('track_key', 'dsa')
  if (moduleFetchError) {
    throw moduleFetchError
  }

  const moduleIdByKey = new Map((modules ?? []).map((row) => [row.module_key, row.id]))

  const orderedProblems = problemRows
    .sort((left, right) => (left.tier - right.tier) || (toNumber(left.module_key.split('-')[1]) - toNumber(right.module_key.split('-')[1])) || (left.problem_lc - right.problem_lc))
    .map((problem, index) => ({
      problem_lc: problem.problem_lc,
      track_key: problem.track_key,
      module_id: moduleIdByKey.get(problem.module_key) ?? null,
      source_type: problem.source_type,
      title: problem.title,
      slug: problem.slug,
      difficulty: problem.difficulty,
      tier: problem.tier,
      phase_order: problem.phase_order,
      study_order: index + 1,
      curation_source: problem.curation_source,
      category: problem.category,
      companies: problem.companies,
      leetcode_url: problem.leetcode_url,
      neetcode_url: problem.neetcode_url,
      is_active: problem.is_active,
    }))

  const { error: problemError } = await supabase
    .from('study_problems')
    .upsert(orderedProblems, { onConflict: 'problem_lc' })
  if (problemError) {
    throw problemError
  }

  const { error: relationError } = await supabase
    .from('problem_relationships')
    .upsert(relationRows, { onConflict: 'from_problem_lc,to_problem_lc,relationship_type' })
  if (relationError) {
    throw relationError
  }

  const { count: totalProblems, error: countError } = await supabase
    .from('study_problems')
    .select('*', { count: 'exact', head: true })
    .eq('track_key', 'dsa')
  if (countError) {
    throw countError
  }

  console.log(
    JSON.stringify(
      {
        imported_pairs: pairs.length,
        imported_modules: moduleRows.size,
        imported_study_problems: orderedProblems.length,
        imported_relationships: relationRows.length,
        total_study_problems_in_db: totalProblems,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exitCode = 1
})
