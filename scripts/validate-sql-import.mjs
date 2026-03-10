import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = '/Users/czarflix/Downloads/DSA'
const DEFAULT_PAYLOAD = path.join(ROOT, 'dsa-app/out/sql-import/sql-import-payload.json')
const CORPUS_PATH = path.join(ROOT, 'sql-rebuild/out/corpus_expanded_candidates.json')
const MANIFEST_PATH = '/Users/czarflix/sql_fetching/new_sql.json'

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function parseArgs(argv) {
  let payloadPath = DEFAULT_PAYLOAD
  let outPath = ''
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--payload' && next) {
      payloadPath = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--payload=')) {
      payloadPath = arg.slice('--payload='.length).trim()
      continue
    }
    if (arg === '--out' && next) {
      outPath = next.trim()
      index += 1
      continue
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length).trim()
    }
  }
  return {
    payloadPath: path.resolve(payloadPath),
    outPath: outPath ? path.resolve(outPath) : '',
  }
}

function buildManifestRows(manifest) {
  const rows = []
  for (const phase of manifest.phases ?? []) {
    for (const [index, problem] of (phase.problems ?? []).entries()) {
      rows.push({
        ...problem,
        phase_id: phase.phase_id,
        phase_name: phase.phase_name,
        study_order: index + 1,
      })
    }
  }
  return rows
}

function uniqueValues(rows, field) {
  return Array.from(new Set(rows.map((row) => row[field]).filter(Boolean))).sort()
}

function toCounts(rows, field) {
  return rows.reduce((acc, row) => {
    const key = String(row[field])
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

async function main() {
  const { payloadPath, outPath } = parseArgs(process.argv.slice(2))
  const [payload, corpus, manifest] = await Promise.all([
    readJson(payloadPath),
    readJson(CORPUS_PATH),
    readJson(MANIFEST_PATH),
  ])

  const manifestRows = buildManifestRows(manifest)
  const manifestByProblemId = new Map(manifestRows.map((row) => [String(row.problem_id), row]))
  const corpusByProblemKey = new Map(corpus.map((row) => [row.problem_key, row]))

  const problems = Array.isArray(payload.study_problems) ? payload.study_problems : []
  const contentRows = Array.isArray(payload.problem_content) ? payload.problem_content : []
  const specRows = Array.isArray(payload.sql_problem_specs) ? payload.sql_problem_specs : []
  const fixtureRows = Array.isArray(payload.sql_problem_fixtures) ? payload.sql_problem_fixtures : []
  const refRows = Array.isArray(payload.sql_problem_reference_solutions) ? payload.sql_problem_reference_solutions : []
  const moduleRows = Array.isArray(payload.study_modules) ? payload.study_modules : []

  const selectedProblemKeys = new Set(problems.map((row) => row.problem_key))
  const selectedProblemIds = new Set(problems.map((row) => String(row.source_problem_id)))

  const duplicateProblemKeys = problems
    .map((row) => row.problem_key)
    .filter((value, index, array) => array.indexOf(value) !== index)

  const duplicateProblemIds = problems
    .map((row) => String(row.source_problem_id))
    .filter((value, index, array) => array.indexOf(value) !== index)

  const missingFromCorpus = problems.filter((row) => !corpusByProblemKey.has(row.problem_key)).map((row) => row.problem_key)
  const missingFromManifest = problems
    .filter((row) => !manifestByProblemId.has(String(row.source_problem_id)))
    .map((row) => row.problem_key)

  const manifestSubset = manifestRows.filter((row) => selectedProblemIds.has(String(row.problem_id)))
  const manifestSubsetIds = new Set(manifestSubset.map((row) => String(row.problem_id)))

  const extrasVsManifest = problems
    .filter((row) => !manifestSubsetIds.has(String(row.source_problem_id)))
    .map((row) => row.problem_key)

  const missingVsManifest = manifestSubset
    .filter((row) => !selectedProblemIds.has(String(row.problem_id)))
    .map((row) => String(row.problem_id))

  const phaseTierDrift = []
  for (const row of problems) {
    const manifestRow = manifestByProblemId.get(String(row.source_problem_id))
    if (!manifestRow) {
      continue
    }
    const expectedModuleKey = `sql-phase-${manifestRow.phase_id}`
    if (row.module_key !== expectedModuleKey || Number(row.tier) !== Number(manifestRow.tier) || Number(row.phase_order) !== Number(manifestRow.study_order)) {
      phaseTierDrift.push({
        problem_key: row.problem_key,
        problem_id: row.source_problem_id,
        title: row.title,
        actual: {
          module_key: row.module_key,
          tier: row.tier,
          phase_order: row.phase_order,
        },
        expected: {
          module_key: expectedModuleKey,
          tier: manifestRow.tier,
          phase_order: manifestRow.study_order,
        },
      })
    }
  }

  const perProblemFixtureCounts = fixtureRows.reduce((acc, row) => {
    acc[row.problem_key] = (acc[row.problem_key] ?? 0) + 1
    return acc
  }, {})

  const perProblemPublicFixtureCounts = fixtureRows.reduce((acc, row) => {
    if (row.is_public) {
      acc[row.problem_key] = (acc[row.problem_key] ?? 0) + 1
    }
    return acc
  }, {})

  const missingFixtureProblems = problems.filter((row) => !perProblemFixtureCounts[row.problem_key]).map((row) => row.problem_key)
  const missingPublicFixtureProblems = problems.filter((row) => !perProblemPublicFixtureCounts[row.problem_key]).map((row) => row.problem_key)

  const missingContentProblems = problems.filter((row) => !contentRows.some((content) => content.problem_key === row.problem_key)).map((row) => row.problem_key)
  const missingPresentationProblems = problems
    .filter((row) => {
      const content = contentRows.find((entry) => entry.problem_key === row.problem_key)
      if (!content || !content.presentation || typeof content.presentation !== 'object' || Array.isArray(content.presentation)) {
        return true
      }
      const requiredKeys = ['statement', 'schema', 'examples', 'requirements', 'source']
      return requiredKeys.some((key) => !(key in content.presentation))
    })
    .map((row) => row.problem_key)
  const missingSpecProblems = problems.filter((row) => !specRows.some((spec) => spec.problem_key === row.problem_key)).map((row) => row.problem_key)
  const missingReferenceProblems = problems.filter((row) => !refRows.some((ref) => ref.problem_key === row.problem_key)).map((row) => row.problem_key)

  const trackValues = uniqueValues(problems, 'track_key')
  const phases = uniqueValues(problems, 'module_key')
  const summary = {
    payload_path: payloadPath,
    counts: {
      study_modules: moduleRows.length,
      study_problems: problems.length,
      problem_content: contentRows.length,
      sql_problem_specs: specRows.length,
      sql_problem_fixtures: fixtureRows.length,
      sql_problem_reference_solutions: refRows.length,
    },
    tracks: trackValues,
    phases,
    tiers: toCounts(problems, 'tier'),
    fixture_counts: {
      min: Math.min(...Object.values(perProblemFixtureCounts)),
      max: Math.max(...Object.values(perProblemFixtureCounts)),
      public_min: Math.min(...Object.values(perProblemPublicFixtureCounts)),
      public_max: Math.max(...Object.values(perProblemPublicFixtureCounts)),
    },
    integrity: {
      duplicate_problem_keys: duplicateProblemKeys,
      duplicate_problem_ids: duplicateProblemIds,
      missing_from_corpus: missingFromCorpus,
      missing_from_manifest: missingFromManifest,
      extras_vs_manifest: extrasVsManifest,
      missing_vs_manifest: missingVsManifest,
      phase_tier_drift: phaseTierDrift,
      missing_fixture_problems: missingFixtureProblems,
      missing_public_fixture_problems: missingPublicFixtureProblems,
      missing_content_problems: missingContentProblems,
      missing_presentation_problems: missingPresentationProblems,
      missing_spec_problems: missingSpecProblems,
      missing_reference_problems: missingReferenceProblems,
    },
  }

  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, JSON.stringify(summary, null, 2))
  }

  console.log(JSON.stringify(summary, null, 2))

  const hasIssues = [
    duplicateProblemKeys.length,
    duplicateProblemIds.length,
    missingFromCorpus.length,
    missingFromManifest.length,
    extrasVsManifest.length,
    missingVsManifest.length,
    phaseTierDrift.length,
    missingFixtureProblems.length,
    missingPublicFixtureProblems.length,
    missingContentProblems.length,
    missingPresentationProblems.length,
    missingSpecProblems.length,
    missingReferenceProblems.length,
  ].some((count) => count > 0)

  if (hasIssues) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
