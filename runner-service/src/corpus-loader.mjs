/**
 * corpus-loader.mjs
 *
 * Loads SQL problem spec + fixtures for a given problem_key.
 *
 * Primary path:  Supabase `sql_problem_specs` + `sql_problem_fixtures` tables.
 * Fallback path: Local corpus JSON file (for dev / before DB tables are populated).
 *                Set SQL_CORPUS_PATH env var, or the loader auto-detects the
 *                standard location relative to the runner-service directory.
 *
 * Callers receive { submission_kind, fixtures[] } or null if not found.
 */

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {object[] | null} */
let _corpusCache = null
let _corpusLoadAttempted = false

/**
 * Load spec + fixtures for a SQL problem.
 *
 * @param {string} problemKey  e.g. "sql-leetcode-175"
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{submission_kind: string, fixtures: object[]} | null>}
 */
export async function loadSqlProblem(problemKey, supabase) {
  const fromDb = await _loadFromDb(problemKey, supabase)
  if (fromDb) return fromDb
  return _loadFromCorpus(problemKey)
}

async function _loadFromDb(problemKey, supabase) {
  try {
    const { data: spec, error: specError } = await supabase
      .from('sql_problem_specs')
      .select('submission_kind')
      .eq('problem_key', problemKey)
      .maybeSingle()

    if (specError || !spec) return null

    const { data: fixtures, error: fxError } = await supabase
      .from('sql_problem_fixtures')
      .select(
        'fixture_key,label,sort_order,is_public,setup_sql,postcheck_sql,expected_columns,expected_rows,comparison_mode,order_required',
      )
      .eq('problem_key', problemKey)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (fxError || !fixtures || fixtures.length === 0) return null

    return { submission_kind: spec.submission_kind, fixtures }
  } catch {
    return null
  }
}

async function _loadFromCorpus(problemKey) {
  const corpus = await _getCorpus()
  if (!corpus) return null

  const problem = corpus.find((p) => p.problem_key === problemKey)
  if (!problem) return null

  return {
    submission_kind: problem.submission_kind,
    fixtures: (problem.fixtures || []).map((f) => ({
      fixture_key: f.fixture_key,
      label: f.label,
      sort_order: f.sort_order,
      is_public: Boolean(f.is_public),
      setup_sql: f.setup_sql,
      postcheck_sql: f.postcheck_sql || null,
      expected_columns: f.expected_columns,
      expected_rows: f.expected_rows,
      comparison_mode: f.comparison_mode,
      order_required: Boolean(f.order_required),
    })),
  }
}

async function _getCorpus() {
  if (_corpusCache) return _corpusCache
  if (_corpusLoadAttempted) return null
  _corpusLoadAttempted = true

  const corpusPath = process.env.SQL_CORPUS_PATH || _detectDefaultCorpusPath()
  if (!corpusPath) return null

  try {
    const text = await readFile(corpusPath, 'utf8')
    _corpusCache = JSON.parse(text)
    process.stdout.write(
      `[corpus-loader] Loaded ${_corpusCache.length} SQL problems from corpus file\n`,
    )
    return _corpusCache
  } catch (err) {
    process.stderr.write(
      `[corpus-loader] Could not load corpus from ${corpusPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return null
  }
}

function _detectDefaultCorpusPath() {
  // runner-service/src/ → runner-service/ → dsa-app/ → DSA/
  // Then sql-rebuild/out/corpus_expanded_candidates.json
  return resolve(__dirname, '../../..', 'sql-rebuild/out/corpus_expanded_candidates.json')
}
