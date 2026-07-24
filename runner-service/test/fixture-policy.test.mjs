import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/202607230001_hide_private_sql_fixtures.sql',
  import.meta.url,
)

test('authenticated fixture reads are restricted to public rows', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /DROP POLICY IF EXISTS sql_problem_fixtures_read_authenticated/)
  assert.match(migration, /CREATE POLICY sql_problem_fixtures_read_public_authenticated/)
  assert.match(migration, /current_user_key\(\) IS NOT NULL AND is_public = true/)
})
