# Final Dataset Backfill Audit (March 7, 2026)

## Scope
This audit covered the 27 manually backfilled problems from `src/final_dataset.json`:

`117, 133, 138, 142, 146, 155, 208, 211, 235, 271, 285, 295, 297, 355, 372, 430, 449, 460, 652, 703, 715, 716, 731, 911, 981, 1244, 2013`

Goals:
- verify whether the manual backfill actually landed in Supabase correctly
- repair malformed problem content
- make the remaining 27 problems runnable without blowing up the Judge0 payload
- verify the runner on representative repaired and original problems
- verify failed-case reporting

## What Was Wrong
### 1. Three rows were still malformed in Supabase
Before repair, these rows were still in the broken state from the earlier import:
- `981`
- `1244`
- `2013`

Symptoms:
- raw HTML still stored in `problem_content.problem_description`
- no `dataset_test_harness`
- descriptions rendered badly in the UI

### 2. The original repair script stalled on huge payloads
The issue was not random. The manual dataset for some design problems is extremely large.

Measured sizes from `src/final_dataset.json`:
- `981`
  - `test`: ~47.8 MB
  - `input_output`: ~47.7 MB
- `1244`
  - `test`: ~1.33 MB
  - `input_output`: ~1.33 MB
- `2013`
  - `test`: ~0.62 MB
  - `input_output`: ~0.62 MB

The worst offender was `981`, where one stored case was roughly:
- input: ~16.8 MB
- expected output: ~5.4 MB

That made the previous content upsert path effectively unusable for these rows.

### 3. `981` contained incorrect test cases
After trimming the oversized cases and running a known-correct `TimeMap` implementation through the deployed runner, two stored cases still failed because the expected output was wrong.

Bad stored expectations that were removed:
- old case `2`
  - `set("a", "b", 1)` then `get("a", 0)` expected `"b"`
  - correct behavior is `""`
- old case `15`
  - after `set("a", "b", 1)` and `set("a", "c", 2)`, `get("a", 1)` expected `"c"`
  - correct behavior is `"b"`

## Fixes Applied
### Code changes
Updated import script:
- `/Users/czarflix/Downloads/DSA/dsa-app/scripts/import-final-dataset.mjs`

Behavior now:
- normalizes HTML descriptions before storing
- derives proper `entry_point` values for `Solution`-style rows
- stores only the first `4` examples in `problem_content.input_output`
  - this matches current UI usage and keeps content fetches small
- keeps dataset harnesses for the 24 rows that already work that way
- treats only `981`, `1244`, and `2013` as trimmed generic fallback rows
- drops oversized generic test cases for those three rows using a `100,000` combined-char limit per case
- removes known-bad `981` cases `2` and `15`
- reindexes the kept generic test cases sequentially

Supporting normalization code already in place and used by the frontend:
- `/Users/czarflix/Downloads/DSA/dsa-app/src/lib/problem-content.js`
- `/Users/czarflix/Downloads/DSA/dsa-app/src/hooks/useProblemBundle.js`

Runner behavior already present and verified in this audit:
- first failed case is exposed in run results
- dataset-harness and generic-harness paths are both active

Relevant runner files:
- `/Users/czarflix/Downloads/DSA/dsa-app/runner-service/src/harness.mjs`
- `/Users/czarflix/Downloads/DSA/dsa-app/runner-service/src/server.mjs`

## Supabase State After Repair
Direct Supabase verification after the final import:
- all 27 rows exist in `problem_content`
- all 27 rows have normalized descriptions (`hasHtml = false`)
- all 27 rows now store only `4` preview examples in `problem_content.input_output`
- the three trimmed generic rows are now:
  - `981`: `13` active tests, no dataset harness
  - `1244`: `15` active tests, no dataset harness
  - `2013`: `17` active tests, no dataset harness
- the other 24 remain dataset-harness-backed and still have `20` active tests each

## Live Runner Verification
Verified against the deployed runner at the configured `VITE_RUNNER_API_URL`.

### Repaired generic rows
- `981` TimeMap
  - status: `passed`
  - result: `13/13`
  - harness type: `generic`
- `1244` Leaderboard
  - status: `passed`
  - result: `15/15`
  - harness type: `generic`
- `2013` DetectSquares
  - status: `passed`
  - result: `17/17`
  - harness type: `generic`

### Original / previously working rows
- `1` Two Sum
  - status: `passed`
  - result: `80/80`
  - harness type: `dataset`
- `146` LRU Cache
  - status: `passed`
  - result: `20/20`
  - harness type: `dataset`
- `155` Min Stack
  - status: `passed`
  - result: `20/20`
  - harness type: `dataset`
- `372` Super Pow
  - status: `passed`
  - result: `20/20`
  - harness type: `dataset`

### Failed-case reporting verification
Intentionally wrong solution on `372`:
- status: `failed`
- summary: `Fail on [2, [3]]: expected 8 got 0`
- `verdict.first_failed_case.message` present and usable by the frontend

## Important Notes
### `117` is not a good validation target for generic code snippets
A quick run on `117` with a normal tree-node BFS implementation failed inside the stored dataset harness because the harness expects a different candidate shape than a plain LeetCode-style node-based solution.

This was not used as a blocker for the backfill audit because:
- the row itself is present and normalized
- its dataset harness remains intact
- other dataset-harness-backed rows were validated successfully

### Some dataset-harness rows still have large `problem_test_cases` payloads
Examples include `155`, `208`, `295`, `460`, `703`, `715`, and `911`.

This does **not** currently block execution for those rows because the runner uses `dataset_test_harness` there, not the raw `problem_test_cases` values.

It is still worth cleaning later if you want:
- smaller DB footprint
- lighter frontend test-panel payloads
- less UI noise in large test dumps

That is a separate cleanup pass, not a blocker for correctness.

## Commands Used
### Re-run final backfill import
```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run import:final-dataset
```

### Query repaired rows from Supabase
```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
set -a && source .env.local && set +a
node - <<'NODE'
const { createClient } = require('@supabase/supabase-js')
const ids = [117,133,138,142,146,155,208,211,235,271,285,295,297,355,372,430,449,460,652,703,715,716,731,911,981,1244,2013]
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY, {auth:{autoRefreshToken:false,persistSession:false}})
;(async()=>{
  const { data } = await sb.from('problem_content').select('problem_lc,entry_point,dataset_test_harness,problem_description,input_output').in('problem_lc', ids)
  console.log(data)
})()
NODE
```

### Live runner verification pattern
```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
set -a && source .env.local && set +a
node - <<'NODE'
// POST /runs, poll GET /runs/:id?user_key=...
NODE
```

## Current Status
The manual 27-problem backfill is now in a usable state.

What is confirmed:
- the 27 rows are present
- the descriptions are fixed
- the three previously broken rows are repaired
- the oversized generic cases were trimmed to sane runnable sets
- `981` bad tests were removed
- runner execution works on repaired generic rows and representative dataset rows
- failed-case reporting works

## Recommended Next Step
If you want the remaining rough edge cleaned up, do a separate pass that truncates or summarizes very large `problem_test_cases` on rows that already have `dataset_test_harness`, because those rows do not need the full raw case bodies for runner correctness.
