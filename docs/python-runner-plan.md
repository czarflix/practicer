# Python Runner Implementation Plan (Two-User Hosted Setup)

## Phase 1: Data Foundation

1. Add `problem_content`, `problem_test_cases`, `code_runs`.
2. Import dataset rows for matched LC IDs.
3. Keep unmatched problems as `source='manual'`.

Status: implemented in this pass.

## Phase 2: Runner Service (Judge0 on EC2)

1. Deploy Judge0 CE via Docker Compose on EC2.
2. Expose only a private API endpoint (or IP-allowlist your app server).
3. Enforce Python-only submissions in your app backend.
4. Set strict limits:
   - CPU time
   - memory
   - output size
   - wall-clock timeout

## Phase 3: App Backend Runner API

1. Add endpoint: `POST /api/runs`
   - inputs: `problem_lc`, `code`
   - lookup active tests from `problem_test_cases`
   - generate Python harness
   - submit to Judge0
2. Poll Judge0 and persist final result in `code_runs`.
3. Add endpoint: `GET /api/runs/:id`.

## Phase 4: Settings UI for Test Management

1. Add `Problem Tests` section in Settings:
   - list dataset tests
   - add/edit/delete manual tests
   - enable/disable test cases
2. Save edits in `problem_test_cases` with `source='manual'`.
3. Add quick tools:
   - clone from dataset
   - bulk disable dataset tests
   - export/import tests JSON

## Phase 5: Accuracy Loop vs LeetCode

1. After LeetCode mismatch, add missing edge case in app Settings.
2. Re-run locally and persist improved test bank.
3. Track drift by storing run metadata in `code_runs.runner_meta`.

## Safety Notes

1. Never execute user Python directly in your web app server.
2. Always use sandboxed execution (Judge0 container isolation).
3. Restrict network access in execution containers.
4. Keep execution service isolated from your DB credentials.
