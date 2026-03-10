# Dataset 273 Live Audit - 2026-03-07

## Scope
Audit the 273 dataset-backed `problem_content` rows (excluding the separately repaired manual 27), using the live runner and external reference solutions where possible.

## Runner changes made first
File: `/Users/czarflix/Downloads/DSA/dsa-app/runner-service/src/harness.mjs`

Added dataset-harness compatibility helpers:
- `tree_node(...)`
- `list_node(...)`
- `is_same_list(...)`
- `is_same_tree(...)`
- JSON-style aliases: `null`, `true`, `false`
- `pairwise` compatibility in the Python prelude
- positional fallback for kwargs mismatches

The runner was rebuilt and redeployed on EC2 before the clean rerun.

## Full external live audit
Artifact:
- `/Users/czarflix/fetchinh/audit_dataset273_live_results.json`

Initial clean rerun result:
- `255 / 273` passed against external references (`doocs` first, `kamyu` fallback)
- `18 / 273` unresolved

Those 18 were then rechecked with a stronger audit prefix and targeted patching.
Artifact:
- `/Users/czarflix/fetchinh/audit_dataset273_unresolved_recheck.json`

Targeted recheck cleared these source-noise rows:
- `260`
- `973`

## Direct canonical verification of unresolved rows
Artifact:
- `/Users/czarflix/fetchinh/manual_unresolved_live_check.json`

Manual canonical solutions were run against the live runner for the unresolved rows.

Rows confirmed okay without DB repair:
- `23`
- `200`
- `323`
- `416`
- `719`

Rows confirmed bad/problematic in the stored dataset state:
- `33`
- `37`
- `153`
- `167`
- `212`
- `227`
- `230`
- `287`
- `778`

Rows confirmed too heavy / runner-unfriendly and better repaired with reduced curated cases:
- `322`
- `1219`

## DB repairs applied
Repair script:
- `/Users/czarflix/Downloads/DSA/dsa-app/scripts/repair-dataset273-outliers.mjs`

Repair summary:
- `/Users/czarflix/Downloads/DSA/dsa-app/docs/dataset273-outlier-repair-summary-2026-03-07.json`

Rows repaired:
- `33`
- `37`
- `153`
- `167`
- `212`
- `227`
- `230`
- `287`
- `322`
- `778`
- `1219`

Repair strategy:
- Replaced broken/heavy dataset rows with reduced curated cases
- Used generic test cases where possible
- Used custom dataset harnesses only where required:
  - `37` Sudoku Solver
  - `212` Word Search II
  - `230` Kth Smallest Element in a BST
- Marked `problem_content.source = 'mixed'`
- Replaced `problem_test_cases` for the repaired rows with curated `manual` rows

## Post-repair live verification
Artifact:
- `/Users/czarflix/fetchinh/manual_repaired_live_check.json`

All repaired/problematic rows were re-run live after the DB update.

Final repaired-row verification:
- `23` passed `3/3`
- `33` passed `8/8`
- `37` passed `3/3`
- `153` passed `8/8`
- `167` passed `8/8`
- `200` passed `59/59`
- `212` passed `4/4`
- `227` passed `10/10`
- `230` passed `6/6`
- `287` passed `8/8`
- `322` passed `8/8`
- `323` passed `71/71`
- `416` passed `86/86`
- `719` passed `76/76`
- `778` passed `6/6`
- `1219` passed `7/7`

## Final state
Current confidence for the 273 dataset-backed rows:
- high enough to use as the canonical app dataset
- practical confidence: `~9.7 / 10`

Reason it is not `10 / 10`:
- some repaired rows now use curated reduced cases instead of the original imported dataset harnesses
- external reference repos were not available or trustworthy for every single row after Python-version/source drift

But the important part is now true:
- the live runner works against the current stored Supabase dataset
- the known broken dataset-backed outliers were repaired, not ignored
- the repaired rows were reverified end-to-end on the deployed runner
