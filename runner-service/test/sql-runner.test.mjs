import assert from 'node:assert/strict'
import test from 'node:test'

import * as sqlRunner from '../src/sql-runner.mjs'

function requireExport(name) {
  assert.equal(typeof sqlRunner[name], 'function', `${name} must be exported for boundary testing`)
  return sqlRunner[name]
}

function fixture(overrides = {}) {
  return {
    fixture_key: 'public-case',
    label: 'Public case',
    sort_order: 1,
    is_public: true,
    setup_sql: 'CREATE TABLE scores (value integer)',
    postcheck_sql: null,
    expected_columns: ['value'],
    expected_rows: [[1]],
    comparison_mode: 'ordered_rows',
    order_required: true,
    ...overrides,
  }
}

function fakeClient({ userSql = 'SELECT 1 AS value', failWith = null } = {}) {
  const queries = []
  return {
    queries,
    async query(sql) {
      queries.push(sql)
      if (sql === userSql) {
        if (failWith) throw failWith
        return { fields: [{ name: 'value' }], rows: [{ value: 1 }] }
      }
      return { fields: [], rows: [] }
    },
  }
}

test('submission validation rejects control-plane operations but preserves controlled DML', () => {
  const validateSqlSubmission = requireExport('validateSqlSubmission')

  for (const sql of [
    'ALTER ROLE app_user SUPERUSER',
    'CREATE ROLE intruder LOGIN',
    'DROP DATABASE practicer',
    'CREATE SCHEMA escaped',
    'SET search_path TO public',
    "COPY scores TO PROGRAM 'id'",
  ]) {
    assert.throws(() => validateSqlSubmission(sql), /blocked control-plane operation/)
  }

  assert.doesNotThrow(() => validateSqlSubmission('UPDATE scores SET value = value + 1'))
})

test('submission validation enforces the configured statement-size limit', () => {
  const validateSqlSubmission = requireExport('validateSqlSubmission')
  assert.throws(() => validateSqlSubmission('x'.repeat(50_001)), /50000 character limit/)
  assert.doesNotThrow(() => validateSqlSubmission('x'.repeat(50_000)))
})

test('run-mode fixture selection excludes hidden checks while submit mode includes them', () => {
  const selectSqlFixtures = requireExport('selectSqlFixtures')
  const fixtures = [
    fixture(),
    fixture({ fixture_key: 'hidden-case', label: 'Hidden case', is_public: false }),
  ]

  assert.deepEqual(
    selectSqlFixtures({ fixtures, selectedCaseIds: null }).map((item) => item.fixture_key),
    ['public-case'],
  )
  assert.throws(
    () => selectSqlFixtures({ fixtures, selectedCaseIds: ['hidden-case'] }),
    /eligible fixture keys/,
  )
  assert.deepEqual(
    selectSqlFixtures({ fixtures, selectedCaseIds: null, includeHidden: true }).map(
      (item) => item.fixture_key,
    ),
    ['public-case', 'hidden-case'],
  )
})

test('fixture execution applies timeouts, unique random schemas, and rollback', async () => {
  const runFixture = requireExport('runFixture')
  const first = fakeClient()
  const second = fakeClient()

  await runFixture(first, fixture(), 'SELECT 1 AS value', 'query')
  await runFixture(second, fixture(), 'SELECT 1 AS value', 'query')

  for (const client of [first, second]) {
    assert.ok(client.queries.some((sql) => /^SET LOCAL statement_timeout = \d+$/.test(sql)))
    assert.ok(client.queries.some((sql) => /^SET LOCAL lock_timeout = \d+$/.test(sql)))
    assert.equal(client.queries.at(-1), 'ROLLBACK')
  }

  const firstSchema = first.queries.find((sql) => sql.startsWith('CREATE SCHEMA '))
  const secondSchema = second.queries.find((sql) => sql.startsWith('CREATE SCHEMA '))
  assert.match(firstSchema, /^CREATE SCHEMA "sql_run_[a-f0-9]{8}"$/)
  assert.match(secondSchema, /^CREATE SCHEMA "sql_run_[a-f0-9]{8}"$/)
  assert.notEqual(firstSchema, secondSchema)
})

test('fixture execution rolls back after a database error and redacts the raw error', async () => {
  const runFixture = requireExport('runFixture')
  const client = fakeClient({ failWith: new Error('private table secret_marker does not exist') })

  const result = await runFixture(client, fixture(), 'SELECT 1 AS value', 'query')

  assert.equal(client.queries.at(-1), 'ROLLBACK')
  assert.equal(result.passed, false)
  assert.equal(result.error, 'SQL execution failed.')
  assert.doesNotMatch(JSON.stringify(result), /secret_marker/)
})

test('hidden fixture results disclose only an opaque check id and pass/fail status', async () => {
  const runFixture = requireExport('runFixture')
  const hidden = fixture({
    fixture_key: 'hidden-salary-edge-case',
    label: 'Hidden salary edge case',
    is_public: false,
    expected_rows: [['hidden_expected_marker']],
  })
  const client = fakeClient()

  const result = await runFixture(client, hidden, 'SELECT 1 AS value', 'query')
  const serialized = JSON.stringify(result)

  assert.match(result.id, /^hidden-check-[a-f0-9]{12}$/)
  assert.equal(result.label, 'Hidden check')
  assert.equal(result.expected, null)
  assert.equal(result.output, null)
  assert.doesNotMatch(serialized, /hidden-salary-edge-case|Hidden salary edge case|hidden_expected_marker/)
})

test('public fixture results retain expected and actual rows for the sample UI', async () => {
  const runFixture = requireExport('runFixture')
  const result = await runFixture(fakeClient(), fixture(), 'SELECT 1 AS value', 'query')

  assert.deepEqual(result.expected, { columns: ['value'], rows: [[1]] })
  assert.deepEqual(result.output, { columns: ['value'], rows: [[1]] })
  assert.equal(result.passed, true)
})
