/**
 * sql-runner.mjs
 *
 * SQL execution path for the DSA runner service.
 *
 * Execution model (mirrors postgres_verify.py):
 *   For each fixture:
 *     1. BEGIN transaction
 *     2. CREATE SCHEMA sql_run_<random>
 *     3. SET LOCAL search_path TO <schema>, public
 *     4. Execute setup_sql
 *     5. If submission_kind = 'query': execute user SQL, compare result
 *        If submission_kind = 'script': execute user SQL, then postcheck_sql, compare result
 *     6. ROLLBACK (execution tables never persist)
 *
 * Why schema-per-fixture:
 *   - Different problems may share table names.
 *   - Different fixtures need independent data.
 *   - Concurrent users must not collide.
 *   - ROLLBACK ensures full cleanup.
 */

import pg from 'pg'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { runnerConfig } from './config.mjs'

// Have pg return numeric (OID 1700) as float rather than string.
// All expected values in the corpus are already stored as JSON floats.
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)))
// Return int8 (OID 20) as number. Values in realistic SQL problems are small.
pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)))

/** @type {pg.Pool | null} */
let _pool = null

function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: runnerConfig.sqlExecPgDsn,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
    _pool.on('error', (err) => {
      process.stderr.write(`[sql-runner] Pool error: ${err.message}\n`)
    })
  }
  return _pool
}

const CONTROL_PLANE_SQL = /\b(?:ALTER\s+(?:SYSTEM|ROLE|USER|DATABASE|SCHEMA|TABLESPACE)|COPY\s+.*\b(?:PROGRAM|FROM|TO)\b|CREATE\s+(?:EXTENSION|ROLE|USER|DATABASE|SCHEMA|TABLESPACE)|DROP\s+(?:ROLE|USER|DATABASE|SCHEMA|TABLESPACE)|GRANT|REVOKE|LOAD|VACUUM|SET\s+(?:(?:LOCAL|SESSION)\s+)?SEARCH_PATH|SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION|DO)\b/i

export function validateSqlSubmission(userSql) {
  if (typeof userSql !== 'string') {
    throw new Error('SQL submission must be a string')
  }
  if (userSql.length > runnerConfig.maxSqlChars) {
    throw new Error(`SQL submission exceeds the ${runnerConfig.maxSqlChars} character limit`)
  }
  if (CONTROL_PLANE_SQL.test(userSql)) {
    throw new Error('SQL submission contains a blocked control-plane operation')
  }
}

export function selectSqlFixtures({ fixtures, selectedCaseIds, includeHidden = false }) {
  const eligibleFixtures = includeHidden
    ? fixtures
    : fixtures.filter((fixture) => fixture.is_public === true)

  const selected =
    Array.isArray(selectedCaseIds) && selectedCaseIds.length > 0
      ? eligibleFixtures.filter((fixture) => selectedCaseIds.includes(fixture.fixture_key))
      : eligibleFixtures

  if (selected.length === 0) {
    throw new Error(
      selectedCaseIds && selectedCaseIds.length > 0
        ? 'None of the selected_case_ids matched eligible fixture keys'
        : 'No eligible fixtures available for this problem',
    )
  }

  return selected
}

// ─── Value normalisation ─────────────────────────────────────────────────────

/**
 * Convert a value returned by pg into its canonical JSON form,
 * matching the output of Python's to_json_value().
 */
function pgCellToJson(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (value instanceof Date) {
    // pg returns Date objects for both date and timestamp columns.
    // Format as "YYYY-MM-DD HH:MM:SS" to match Python's datetime.isoformat(sep=" ").
    const iso = value.toISOString() // "2021-01-01T00:00:00.000Z"
    return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
  }
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    // pg may return numeric values as strings for some types.
    const trimmed = value.trim()
    const n = Number(trimmed)
    if (trimmed !== '' && !isNaN(n) && isFinite(n)) return n
    return trimmed
  }
  return value
}

/**
 * Normalise a cell for comparison.
 * Mirrors Python's _normalize_scalar_for_compare().
 */
function normalizeCell(value) {
  const raw = pgCellToJson(value)
  if (raw === null) return null
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    // Use a stable string representation to avoid float precision drift.
    return parseFloat(raw.toPrecision(12))
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    // Numeric string (may come from corpus expected values)
    const n = Number(trimmed)
    if (trimmed !== '' && !isNaN(n) && isFinite(n)) return parseFloat(n.toPrecision(12))
    // Timestamp T→space normalisation: "2021-01-01T00:00:00" → "2021-01-01 00:00:00"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed.replace('T', ' ')
    }
    return trimmed
  }
  return raw
}

function normalizeRow(row) {
  return row.map(normalizeCell)
}

/** Sort key for unordered multiset comparison. */
function rowKey(row) {
  return JSON.stringify(normalizeRow(row))
}

// ─── Result comparison ───────────────────────────────────────────────────────

/**
 * Compare actual vs expected results.
 * Mirrors PostgresVerifier._compare().
 *
 * @returns {{ passed: boolean, message: string | null }}
 */
function compareResults(actualCols, actualRows, expectedCols, expectedRows, comparisonMode, orderRequired) {
  // Column check (case-insensitive)
  const normActualCols = actualCols.map((c) => String(c).toLowerCase())
  const normExpectedCols = expectedCols.map((c) => String(c).toLowerCase())
  if (normActualCols.join(',') !== normExpectedCols.join(',')) {
    return {
      passed: false,
      message: `Column mismatch: got [${normActualCols.join(', ')}], expected [${normExpectedCols.join(', ')}]`,
    }
  }

  // Resolve comparison mode (mirrors Python normalization)
  let mode = comparisonMode
  if (mode === 'exact' || mode === 'ordered_table') {
    mode = 'ordered_rows'
  } else if (mode === 'unordered_table' || mode === 'unordered_multiset' || mode === 'direct_result') {
    mode = 'unordered_multiset'
  } else if (mode === 'postcheck_query') {
    mode = orderRequired ? 'ordered_rows' : 'unordered_multiset'
  }

  const normActual = actualRows.map(normalizeRow)
  const normExpected = expectedRows.map(normalizeRow)

  if (mode === 'single_value') {
    const av = normActual[0]?.[0] ?? null
    const ev = normExpected[0]?.[0] ?? null
    const passed = String(av) === String(ev)
    return { passed, message: passed ? null : `Value mismatch: got ${av}, expected ${ev}` }
  }

  if (mode === 'single_row') {
    if (normActual.length !== 1 || normExpected.length !== 1) {
      return {
        passed: false,
        message: `Row count mismatch: got ${normActual.length}, expected ${normExpected.length}`,
      }
    }
    const passed = rowKey(normActual[0]) === rowKey(normExpected[0])
    return { passed, message: passed ? null : 'Row content mismatch' }
  }

  if (normActual.length !== normExpected.length) {
    return {
      passed: false,
      message: `Row count mismatch: got ${normActual.length}, expected ${normExpected.length}`,
    }
  }

  if (mode === 'ordered_rows') {
    for (let i = 0; i < normActual.length; i++) {
      if (rowKey(normActual[i]) !== rowKey(normExpected[i])) {
        return { passed: false, message: `Row ${i + 1} mismatch` }
      }
    }
    return { passed: true, message: null }
  }

  // unordered_multiset (default)
  const actualKeys = normActual.map(rowKey).sort()
  const expectedKeys = normExpected.map(rowKey).sort()
  for (let i = 0; i < actualKeys.length; i++) {
    if (actualKeys[i] !== expectedKeys[i]) {
      return { passed: false, message: 'Row content mismatch (unordered)' }
    }
  }
  return { passed: true, message: null }
}

// ─── Single-fixture execution ─────────────────────────────────────────────────

/**
 * Run one fixture inside a transaction with schema isolation.
 * Always rolls back — execution tables never persist.
 *
 * @param {pg.PoolClient} client
 * @param {object} fixture
 * @param {string} userSql
 * @param {'query'|'script'} submissionKind
 * @returns {Promise<object>} per-case result record
 */
export async function runFixture(client, fixture, userSql, submissionKind) {
  const schemaName = `sql_run_${randomBytes(4).toString('hex')}`
  const isPublic = fixture.is_public === true
  const resultId = isPublic
    ? fixture.fixture_key
    : `hidden-check-${randomBytes(6).toString('hex')}`
  const resultLabel = isPublic ? fixture.label || fixture.fixture_key : 'Hidden check'

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(runnerConfig.sqlStatementTimeoutMs))}`)
    await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.floor(runnerConfig.sqlStatementTimeoutMs))}`)
    // Create an isolated schema for this fixture run
    await client.query(`CREATE SCHEMA "${schemaName}"`)
    // Restrict search path to our schema + public (for types/extensions)
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`)
    // Set up the fixture data
    await client.query(fixture.setup_sql)

    let result
    if (submissionKind === 'script') {
      // Execute user SQL as a script (no result expected from it)
      await client.query(userSql)
      if (!fixture.postcheck_sql) {
        throw new Error('script fixture is missing postcheck_sql')
      }
      // The postcheck query produces the verifiable result
      result = await client.query(fixture.postcheck_sql)
    } else {
      // Direct query: result comes from user SQL itself
      result = await client.query(userSql)
    }

    const actualCols = result.fields ? result.fields.map((f) => f.name) : []
    // pg returns rows as objects; convert to arrays in column order
    const actualRows = (result.rows || []).map((row) => actualCols.map((col) => row[col]))

    const expectedCols = fixture.expected_columns || []
    const expectedRows = fixture.expected_rows || []

    const comparison = compareResults(
      actualCols,
      actualRows,
      expectedCols,
      expectedRows,
      fixture.comparison_mode,
      Boolean(fixture.order_required),
    )

    await client.query('ROLLBACK')

    return {
      id: resultId,
      label: resultLabel,
      passed: comparison.passed,
      expected: isPublic ? { columns: expectedCols, rows: expectedRows } : null,
      output: isPublic ? { columns: actualCols, rows: actualRows } : null,
      error: null,
      message: isPublic
        ? comparison.message || (comparison.passed ? 'Passed' : 'Failed')
        : comparison.passed
          ? 'Passed'
          : 'Hidden check failed',
    }
  } catch {
    // Always roll back, even on unexpected errors
    await client.query('ROLLBACK').catch(() => undefined)
    return {
      id: resultId,
      label: resultLabel,
      passed: false,
      expected: isPublic
        ? { columns: fixture.expected_columns || [], rows: fixture.expected_rows || [] }
        : null,
      output: isPublic ? { columns: [], rows: [] } : null,
      error: 'SQL execution failed.',
      message: 'Execution error',
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute user SQL against the given fixtures.
 *
 * @param {object} opts
 * @param {string}   opts.userSql          - SQL code submitted by user
 * @param {'query'|'script'} opts.submissionKind
 * @param {object[]} opts.fixtures         - all fixtures for the problem
 * @param {string[]|null} [opts.selectedCaseIds] - if truthy, only these eligible fixture_keys
 * @param {boolean} [opts.includeHidden] - true only for submit/grading mode
 * @returns {Promise<object[]>} array of per-case result records
 */
export async function executeSql({
  userSql,
  submissionKind,
  fixtures,
  selectedCaseIds,
  includeHidden = false,
}) {
  validateSqlSubmission(userSql)
  const pool = getPool()

  const toRun = selectSqlFixtures({ fixtures, selectedCaseIds, includeHidden })

  const results = []
  for (const fixture of toRun) {
    const client = await pool.connect()
    try {
      const caseResult = await runFixture(client, fixture, userSql, submissionKind)
      results.push(caseResult)
    } finally {
      client.release()
    }
  }
  return results
}

/** Gracefully close the connection pool (used on shutdown). */
export async function closeSqlPool() {
  if (_pool) {
    await _pool.end()
    _pool = null
  }
}
