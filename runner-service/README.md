# Practicer runner service

The runner service evaluates Python and SQL practice submissions against visible or hidden fixtures.

## Boundaries

- Python is delegated to a Judge0-compatible service with configured resource limits.
- SQL runs against a dedicated PostgreSQL database, not the Supabase application database. Each fixture receives a random schema and a transaction rollback.
- SQL statement and lock timeouts are set per transaction. Control-plane operations such as role changes, privilege changes, `COPY` transport/file operations, `CREATE EXTENSION`, and `DO` blocks are rejected.
- Hidden fixture results expose only an opaque check identifier and pass/fail state; expected rows, actual rows, fixture metadata, and raw database errors are withheld.
- This is defense in depth, not a claim of secure sandboxing. Verify provider isolation and database-role permissions in deployment.

## Configuration

Copy `.env.example` into an untracked local environment file. Required values include the Supabase service URL/key, Judge0 endpoint, and dedicated SQL execution DSN. Never commit their values.

## Local checks

```bash
npm ci
npm run check
```

`npm run check` performs syntax checks and local behavioral tests for SQL control-plane rejection, size limits, timeout setup, random-schema isolation, rollback, hidden-fixture redaction, public sample preservation, and the checked-in fixture RLS policy. The service requires external Supabase, Judge0, and PostgreSQL dependencies for end-to-end execution; those hosted paths are not proven by the local suite.
