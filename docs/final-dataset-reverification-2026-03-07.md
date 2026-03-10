# Final Dataset Re-Verification (2026-03-07)

This note records the final reduced-and-verified state of the 27 manually backfilled structural/design problems that were imported from `final_dataset.json`.

## Scope

The following LeetCode problems were re-verified:

- `117`
- `133`
- `138`
- `142`
- `146`
- `155`
- `208`
- `211`
- `235`
- `271`
- `285`
- `295`
- `297`
- `355`
- `372`
- `430`
- `449`
- `460`
- `652`
- `703`
- `715`
- `716`
- `731`
- `911`
- `981`
- `1244`
- `2013`

## What Changed

The reducer at `/Users/czarflix/fetchinh/build_verified_reduced_dataset.py` now does the following:

- trims the manual set to at most `15` cases per problem
- removes known-bad `981` reduced-set cases `2` and `15`
- removes oversized stress cases `5` and `6` from `430`
- refreshes problem descriptions/starter code from live LeetCode metadata where available
- builds runner-safe custom harnesses for structural problems
- verifies outputs against:
  - the local solution module in `/Users/czarflix/fetchinh/solve_<id>.py`
  - at least one external source from Doocs or Kamyu
- rewrites outputs only when local/external implementations agree and the stored dataset was wrong

## Output Corrections

The reduced verification pass corrected stored outputs for:

- `117`
- `133`
- `138`
- `271`
- `297`
- `430`
- `449`

## Final Imported Test Counts

After re-import into Supabase on 2026-03-07:

- `430` has `13` active tests
- `981` has `13` active tests
- every other problem in the 27-problem set has `15` active tests

Total imported test rows for the 27-problem set:

- `401`

## Live Runner Verification

The deployed runner at `https://runner.czarflix.me` was exercised after re-import using actual solution code for all 27 problems.

Result:

- all `27/27` problems passed

Per-problem live runner status:

- `117`: `15/15`
- `133`: `15/15`
- `138`: `15/15`
- `142`: `15/15`
- `146`: `15/15`
- `155`: `15/15`
- `208`: `15/15`
- `211`: `15/15`
- `235`: `15/15`
- `271`: `15/15`
- `285`: `15/15`
- `295`: `15/15`
- `297`: `15/15`
- `355`: `15/15`
- `372`: `15/15`
- `430`: `13/13`
- `449`: `15/15`
- `460`: `15/15`
- `652`: `15/15`
- `703`: `15/15`
- `715`: `15/15`
- `716`: `15/15`
- `731`: `15/15`
- `911`: `15/15`
- `981`: `13/13`
- `1244`: `15/15`
- `2013`: `15/15`

## Confidence Statement

This 27-problem subset is now materially stronger than the earlier manual backfill because:

- oversized stress cases were removed where they were distorting payload size or output shape
- output verification is no longer based on a mutating self-consistency loop
- the reduced dataset was checked against external reference implementations
- the exact Supabase-imported rows were exercised through the deployed live runner

Practical confidence level:

- `~9.5/10`

Remaining caveat:

- this is still a reduced, curated verification set, not a proof against every possible hidden LeetCode case
- for a personal study platform, this is a strong and defensible stopping point
