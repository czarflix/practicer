import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = '/Users/czarflix/Downloads/DSA'
const CORPUS_PATH = path.join(ROOT, 'sql-rebuild/out/corpus_expanded_candidates.json')
const MANIFEST_PATH = '/Users/czarflix/sql_fetching/new_sql.json'
const PRESENTATION_PATH = '/Users/czarflix/sql_metadata/sql_workspace_presentation/sql_workspace_presentation_verified.json'
const BASE_OUT_DIR = path.join(ROOT, 'dsa-app/out/sql-import')
const MANIFEST_PROBLEM_ID_OVERRIDES = {
  'sql-medium-assorted-uber-third-transaction': 'uber-third-transaction',
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function canonicalPlatformLabel(url, fallback) {
  const source = String(url || '').toLowerCase()
  if (source.includes('datalemur.com')) return 'DataLemur'
  if (source.includes('stratascratch.com')) return 'StrataScratch'
  if (source.includes('interviewquery.com')) return 'InterviewQuery'
  if (source.includes('hackerrank.com')) return 'HackerRank'
  if (source.includes('leetcode.com') || source.includes('leetcode.ca') || source.includes('leetcode.doocs.org')) {
    return 'LeetCode'
  }
  return fallback
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function parseArgs(argv) {
  const phaseIds = new Set()
  const problemKeys = new Set()
  let outDir = ''
  let label = ''

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--phase' && next) {
      next.split(',').map((value) => Number(value.trim())).filter(Number.isFinite).forEach((value) => phaseIds.add(value))
      index += 1
      continue
    }
    if (arg.startsWith('--phase=')) {
      arg.slice('--phase='.length).split(',').map((value) => Number(value.trim())).filter(Number.isFinite).forEach((value) => phaseIds.add(value))
      continue
    }
    if (arg === '--problem-key' && next) {
      next.split(',').map((value) => value.trim()).filter(Boolean).forEach((value) => problemKeys.add(value))
      index += 1
      continue
    }
    if (arg.startsWith('--problem-key=')) {
      arg.slice('--problem-key='.length).split(',').map((value) => value.trim()).filter(Boolean).forEach((value) => problemKeys.add(value))
      continue
    }
    if (arg === '--out-dir' && next) {
      outDir = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--out-dir=')) {
      outDir = arg.slice('--out-dir='.length).trim()
      continue
    }
    if (arg === '--label' && next) {
      label = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--label=')) {
      label = arg.slice('--label='.length).trim()
    }
  }

  return {
    phaseIds: Array.from(phaseIds).sort((left, right) => left - right),
    problemKeys: Array.from(problemKeys).sort(),
    outDir,
    label,
  }
}

function defaultSelectionLabel({ phaseIds, problemKeys, label }) {
  if (label) {
    return slugify(label)
  }
  if (phaseIds.length > 0) {
    return `phase-${phaseIds.join('-')}`
  }
  if (problemKeys.length > 0) {
    return problemKeys.length === 1 ? slugify(problemKeys[0]) : `selection-${problemKeys.length}`
  }
  return 'all'
}

function buildManifestRows(manifest) {
  const rows = []
  for (const phase of manifest.phases ?? []) {
    for (const [index, problem] of (phase.problems ?? []).entries()) {
      rows.push({
        ...problem,
        phase_id: phase.phase_id,
        phase_name: phase.phase_name,
        phase_why_it_matters: phase.why_it_matters,
        study_order: index + 1,
      })
    }
  }
  return rows
}

function comparisonMode(mode) {
  switch (mode) {
    case 'ordered_rows':
    case 'unordered_multiset':
    case 'single_value':
    case 'single_row':
      return mode
    case 'postcheck_query':
      return 'ordered_rows'
    default:
      return 'ordered_rows'
  }
}

function runtimeKindForRow(row) {
  return row.track_key === 'sql' ? 'sql_postgres' : 'python_problem'
}

function selectRows(corpus, manifestRows, filters) {
  const problemIdsByPhase = new Map()
  for (const row of manifestRows) {
    if (!problemIdsByPhase.has(row.phase_id)) {
      problemIdsByPhase.set(row.phase_id, new Set())
    }
    problemIdsByPhase.get(row.phase_id).add(String(row.problem_id))
  }

  let selected = [...corpus]
  if (filters.phaseIds.length > 0) {
    const allowedProblemIds = new Set(
      filters.phaseIds.flatMap((phaseId) => Array.from(problemIdsByPhase.get(phaseId) ?? [])),
    )
    selected = selected.filter((row) => allowedProblemIds.has(String(row.problem_id)))
  }
  if (filters.problemKeys.length > 0) {
    const allowedKeys = new Set(filters.problemKeys)
    selected = selected.filter((row) => allowedKeys.has(row.problem_key))
  }

  return selected.sort((left, right) => {
    if (left.phase_id !== right.phase_id) {
      return left.phase_id - right.phase_id
    }
    if (left.study_order !== right.study_order) {
      return left.study_order - right.study_order
    }
    return left.title.localeCompare(right.title)
  })
}

function summaryForRows(rows, moduleMap, sqlProblemFixtures, selectionLabel, filters) {
  const phases = Array.from(new Set(rows.map((row) => row.phase_id))).sort((left, right) => left - right)
  const tiers = rows.reduce((acc, row) => {
    const key = String(row.tier)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return {
    selection: {
      label: selectionLabel,
      phases,
      phase_count: phases.length,
      problem_keys: rows.map((row) => row.problem_key),
      filters,
    },
    counts: {
      study_tracks: 1,
      study_modules: moduleMap.size,
      study_problems: rows.length,
      problem_content: rows.length,
      sql_problem_specs: rows.length,
      sql_problem_fixtures: sqlProblemFixtures.length,
      sql_problem_reference_solutions: rows.length,
    },
    tiers,
  }
}

async function main() {
  const filters = parseArgs(process.argv.slice(2))
  const [corpus, manifest, presentationRows] = await Promise.all([
    readJson(CORPUS_PATH),
    readJson(MANIFEST_PATH),
    readJson(PRESENTATION_PATH),
  ])
  const manifestRows = buildManifestRows(manifest)
  const manifestByProblemId = new Map(manifestRows.map((row) => [String(row.problem_id), row]))
  const presentationByProblemKey = new Map(presentationRows.map((row) => [row.problem_key, row.presentation]))

  const selectedRows = selectRows(corpus, manifestRows, filters)
  if (selectedRows.length === 0) {
    throw new Error('No SQL corpus rows matched the requested selection.')
  }

  const selectionLabel = defaultSelectionLabel(filters)
  const outDir = filters.outDir
    ? path.resolve(filters.outDir)
    : selectionLabel === 'all'
      ? BASE_OUT_DIR
      : path.join(BASE_OUT_DIR, selectionLabel)

  const sqlTrack = { key: 'sql', name: 'SQL', sort_order: 2, is_active: true }
  const moduleMap = new Map()
  const studyProblems = []
  const problemContent = []
  const sqlProblemSpecs = []
  const sqlProblemFixtures = []
  const sqlProblemReferenceSolutions = []

  for (const row of selectedRows) {
    const manifestProblemId = MANIFEST_PROBLEM_ID_OVERRIDES[row.problem_key] ?? String(row.problem_id)
    const manifestRow = manifestByProblemId.get(String(manifestProblemId))
    if (!manifestRow) {
      throw new Error(`Missing manifest row for SQL problem_id ${manifestProblemId} (${row.title})`)
    }
    if (!presentationByProblemKey.has(row.problem_key)) {
      throw new Error(`Missing verified presentation row for ${row.problem_key} (${row.title})`)
    }

    const platformLabel = canonicalPlatformLabel(
      row.canonical_source_url || row.source_url || manifestRow.source_url,
      manifestRow.platform || row.platform,
    )
    const sourceProblemId = String(manifestRow.problem_id)
    const title = manifestRow.title || row.title
    const difficulty = manifestRow.difficulty || row.difficulty
    const tier = manifestRow.tier || row.tier
    const sourceUrl = row.source_url || manifestRow.source_url || null
    const canonicalSourceUrl = row.canonical_source_url || row.source_url || manifestRow.source_url || null
    const faangVerification = manifestRow.faang_verification || row.faang_verification
    const inclusionRationale = manifestRow.inclusion_rationale || row.inclusion_rationale

    const moduleKey = `sql-phase-${row.phase_id}`
    moduleMap.set(moduleKey, {
      track_key: 'sql',
      module_key: moduleKey,
      module_number: row.phase_id,
      name: row.phase_name,
      sort_order: row.phase_id,
      description: row.phase_why_it_matters,
      is_active: true,
    })

    studyProblems.push({
      problem_key: row.problem_key,
      problem_lc: null,
      track_key: 'sql',
      module_key: moduleKey,
      source_type: 'core',
      source_platform: platformLabel,
      source_problem_id: sourceProblemId,
      title,
      slug: normalizeText(row.slug, slugify(title)),
      difficulty,
      tier,
      phase_order: row.study_order,
      study_order: row.study_order,
      curation_source: 'sql_curriculum',
      category: row.phase_name,
      companies: normalizeArray(row.companies),
      leetcode_url: platformLabel === 'LeetCode' ? canonicalSourceUrl : null,
      neetcode_url: null,
      is_active: true,
      canonical_source_url: canonicalSourceUrl,
      source_url: sourceUrl,
      faang_verification: faangVerification,
      inclusion_rationale: inclusionRationale,
    })

    problemContent.push({
      problem_key: row.problem_key,
      problem_lc: null,
      task_id: sourceProblemId,
      title,
      difficulty,
      tags: normalizeArray(row.tags),
      problem_description: row.statement_clean,
      statement_raw: row.statement_raw,
      statement_clean: row.statement_clean,
      constraints_text: normalizeText(row.constraints_text),
      starter_snippet: row.starter_sql,
      starter_code: null,
      entry_point: null,
      input_output: normalizeArray(row.examples),
      source: 'manual',
      dataset_split: null,
      editor_language: 'sql',
      runtime_kind: runtimeKindForRow(row),
      presentation: presentationByProblemKey.get(row.problem_key) ?? {},
    })

    sqlProblemSpecs.push({
      problem_key: row.problem_key,
      dialect_original: row.dialect_original,
      dialect_runtime: row.dialect_runtime,
      submission_kind: row.submission_kind,
      result_mode: row.result_mode === 'postcheck_query' ? 'postcheck_query' : 'direct_result',
      starter_sql: row.starter_sql,
      notes: null,
    })

    sqlProblemReferenceSolutions.push({
      problem_key: row.problem_key,
      reference_sql_original: row.reference_sql_original,
      reference_sql_runtime: row.reference_sql_runtime,
      provenance_notes: JSON.stringify({ canonical_source_url: canonicalSourceUrl }),
    })

    for (const fixture of row.fixtures ?? []) {
      sqlProblemFixtures.push({
        problem_key: row.problem_key,
        fixture_key: fixture.fixture_key,
        label: fixture.label,
        sort_order: fixture.sort_order,
        is_public: Boolean(fixture.is_public),
        setup_sql: fixture.setup_sql,
        postcheck_sql: fixture.postcheck_sql,
        expected_columns: normalizeArray(fixture.expected_columns),
        expected_rows: normalizeArray(fixture.expected_rows),
        comparison_mode: comparisonMode(fixture.comparison_mode),
        order_required: Boolean(fixture.order_required),
        is_active: true,
        coverage_tags: normalizeArray(fixture.coverage_tags),
      })
    }
  }

  const summary = summaryForRows(selectedRows, moduleMap, sqlProblemFixtures, selectionLabel, {
    phaseIds: filters.phaseIds,
    problemKeys: filters.problemKeys,
  })

  const payload = {
    summary,
    study_tracks: [sqlTrack],
    study_modules: Array.from(moduleMap.values()).sort((a, b) => a.sort_order - b.sort_order),
    study_problems: studyProblems,
    problem_content: problemContent,
    sql_problem_specs: sqlProblemSpecs,
    sql_problem_fixtures: sqlProblemFixtures,
    sql_problem_reference_solutions: sqlProblemReferenceSolutions,
  }

  await fs.mkdir(outDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outDir, 'sql-import-payload.json'), JSON.stringify(payload, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-study_modules.json'), JSON.stringify(payload.study_modules, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-study_problems.json'), JSON.stringify(payload.study_problems, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-problem_content.json'), JSON.stringify(payload.problem_content, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-problem_specs.json'), JSON.stringify(payload.sql_problem_specs, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-problem_fixtures.json'), JSON.stringify(payload.sql_problem_fixtures, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-problem_reference_solutions.json'), JSON.stringify(payload.sql_problem_reference_solutions, null, 2)),
    fs.writeFile(path.join(outDir, 'sql-import-summary.json'), JSON.stringify(summary, null, 2)),
  ])

  console.log(JSON.stringify({ outDir, ...summary }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
