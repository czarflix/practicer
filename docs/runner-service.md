# Runner Service Setup (Phase 2)

The frontend `Problem Console` now supports polling a custom runner API.

This repo includes a Python-only runner implementation at:

- `runner-service/`

## Endpoints

- `POST /runs`
  - body: `{ user_key, problem_lc, code, mode, solution_id }`
  - creates `code_runs` row with `queued` status
  - processes run in background through Judge0
- `GET /runs/:id?user_key=...`
  - returns the current run row and summary fields

## Environment

Service env values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JUDGE0_URL`
- optional: limits and CORS (`RUNNER_ALLOWED_ORIGIN`)

Frontend env value:

- `VITE_RUNNER_API_URL`

## Notes

- Only Python is accepted.
- Execution uses active rows from `problem_test_cases`.
- Harness expects `problem_content.entry_point` to exist.
- If `mode === submit` and all tests pass, runner marks progress as solved for that user.
