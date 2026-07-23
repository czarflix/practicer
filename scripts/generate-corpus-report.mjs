import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(root, 'docs/corpus-count.json')
const checkOnly = process.argv.includes('--check')

const trackedFiles = new Set(
  execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean),
)

function countArrayFile(path) {
  if (!trackedFiles.has(path)) return null
  const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  if (Array.isArray(value)) return value.length
  if (Array.isArray(value.problems)) return value.problems.length
  return null
}

const dsaSource = 'src/final_dataset.json'
const sqlSource = 'sql-rebuild/out/corpus_expanded_candidates.json'
const dsaCount = countArrayFile(dsaSource)
const sqlCount = countArrayFile(sqlSource)

const report = {
  schema_version: 1,
  scope: 'tracked repository sources only',
  verification_status:
    Number.isInteger(dsaCount) && Number.isInteger(sqlCount) ? 'verified' : 'unverified',
  counts: {
    dsa: dsaCount,
    sql: sqlCount,
    total: Number.isInteger(dsaCount) && Number.isInteger(sqlCount) ? dsaCount + sqlCount : null,
  },
  tracked_sources: {
    dsa: trackedFiles.has(dsaSource) ? dsaSource : null,
    sql: trackedFiles.has(sqlSource) ? sqlSource : null,
  },
  migration_evidence: {
    dsa: {
      path: 'supabase/migrations/202603070003_canonical_study_catalog.sql',
      finding: 'populates study_problems from pre-existing database rows; it does not contain the corpus rows',
    },
    sql: {
      path: 'supabase/migrations/202603080001_problem_key_sql_track.sql',
      finding: 'defines SQL corpus tables but does not seed the SQL problem corpus',
    },
  },
  public_claims: {
    '300 DSA + 148 SQL': false,
    policy: 'Do not publish a numeric corpus claim until both counts are reproduced from tracked sources.',
  },
}

const serialized = `${JSON.stringify(report, null, 2)}\n`

if (checkOnly) {
  let current = ''
  try {
    current = readFileSync(outputPath, 'utf8')
  } catch {
    process.stderr.write('docs/corpus-count.json is missing; run npm run corpus:report\n')
    process.exit(1)
  }
  if (current !== serialized) {
    process.stderr.write('docs/corpus-count.json is stale; run npm run corpus:report\n')
    process.exit(1)
  }
  process.stdout.write('corpus report matches tracked repository sources\n')
} else {
  writeFileSync(outputPath, serialized)
  process.stdout.write('wrote docs/corpus-count.json\n')
}
