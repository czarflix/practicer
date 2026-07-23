# Practicer second-pass fix verification

## Fix Contract

- Replace stale dependency, corpus-size, deployment, and live-grading claims with measured or explicitly unverified status.
- Use lockfile-strict installs in CI and run behavioral runner checks there.
- Preserve controlled SQL DML exercises while rejecting database control-plane operations.
- Preserve public sample-result detail while preventing hidden fixture metadata, expected rows, output rows, and raw database errors from reaching user-visible run records.
- Restrict authenticated direct reads of `sql_problem_fixtures` to rows marked `is_public = true`; the service-role runner and admins retain their existing privileged paths.
- Generate a deterministic machine-readable corpus report from tracked repository sources. If tracked sources cannot prove a count, the report must say so instead of repeating `300 + 148`.

Out of scope: provider credentials, remote repository metadata, deployment mutation, Supabase migration application, pushes, merges, history rewriting, and repository visibility.

Preserved behavior: frontend build/lint, controlled SQL query/script exercises, random per-fixture schemas, transaction rollback, public sample output, and the existing external-service architecture.

## Pass 1 Candidate Shape

The first candidate added a testable SQL submission validator, fixture-level redaction, a public-fixture RLS migration, behavioral tests, lockfile-strict CI, a generated corpus report, and evidence-bounded documentation.

It was initially minimal because each change was owned by the existing runner, migration, CI, or documentation surface without introducing a new service or dependency.

## New Evidence Learned After Pass 1

- Run mode passed an empty selection to `executeSql`, which defaulted to every fixture. Hidden result details were redacted, but run mode could still execute hidden fixtures.
- The original authenticated fixture policy allowed direct reads of rows where `is_public = false`.
- The public default-branch lockfile still contains a nested older DOMPurify entry. The three GitHub alerts are therefore valid remote findings, not merely stale metadata. This repair branch resolves 3.4.12 and audits clean.
- The tracked migrations do not contain the DSA or SQL corpus rows, so the claimed `300 + 148` count cannot be reproduced from this tree.
- The Netlify provider URL returned HTTP 200, while both custom hostnames failed DNS resolution and the runner execution path could not be externally exercised.
- A redacted current-tree scan found zero findings. A bounded all-ref history scan found seven generic API-key signatures in the initial commit. A follow-up, value-free classification identified the repeated Supabase values as browser-safe `sb_publishable_` keys, the 36-character values as non-secret record identifiers, and the SQL password as an explicit replacement placeholder. No service-role or `sb_secret_` value was detected, printed, or copied.

## Pass 2 Clean Fix Shape

Starting fresh from the updated evidence, the clean owner-layer design is:

1. A pure SQL validator owns statement-size and control-plane rejection.
2. A pure fixture selector owns run-versus-submit eligibility: run mode receives public fixtures only; submit mode may include hidden fixtures.
3. Fixture execution owns schema/timeout/rollback behavior and serializes hidden results to opaque pass/fail records.
4. Supabase RLS independently prevents ordinary authenticated clients from directly reading hidden fixture rows.
5. Server-level SQL failures use generic user-visible errors.
6. CI runs these behavioral contracts and checks the deterministic corpus evidence file.
7. Recruiter-facing documentation distinguishes local branch evidence, public default-branch state, and unverified external deployment state.

## Decision

Reshaped. Pass 2 retained the validator, redaction, RLS, CI, and evidence changes, and added the missing fixture-eligibility owner so hidden checks cannot be selected or defaulted into run mode.

## Why The Final Implementation Is Not A Patched-Forward Compromise

The final boundaries match the clean pass-2 design: validation, fixture eligibility, fixture execution, database read policy, and documentation each have one owner. No route-specific flag or UI workaround compensates for an unsafe runner default.

## Red-Green Proof

Pre-fix checks:

- `node --test runner-service/test/sql-runner.test.mjs`: 0 passed, 6 failed because the owner-layer validation and fixture contracts were absent.
- Workflow assertion: failed because `.github/workflows/ci.yml` used `npm install`.
- Documentation assertion: failed on the stale 52-alert statement and unsupported deployment/count claims.
- `test -f docs/corpus-count.json`: failed because no machine-readable corpus evidence existed.

Post-fix and convergence checks:

- `npm --prefix runner-service run check`: 8 passed, 0 failed after syntax checks.
- `npm run corpus:check`: passed.
- Lockfile-strict workflow assertion: passed.
- Stale-claim assertion: passed.

The behavioral tests fail if the validator/selector exports, timeout setup, random schema, rollback, redaction, public sample preservation, or fixture RLS policy are removed.

## Minimality Proof

Changed surfaces are limited to:

- CI install/test commands.
- Root and runner scripts.
- SQL runner validation, fixture selection, fixture serialization, and SQL server error handling.
- One forward Supabase migration for hidden fixture reads.
- Runner behavioral tests.
- One deterministic corpus report generator and generated JSON report.
- README/product/runner status documentation and this verification packet.

No frontend application component, provider configuration, credential, deployment, remote branch, visibility setting, or unrelated migration was changed.

## Validation Results

- Clean installs: root `npm ci` passed; runner `npm ci` passed.
- Runner check: 8 tests passed; 0 failed.
- Frontend lint: passed with `eslint . --quiet`.
- Frontend build: passed; Vite reported only the existing large-chunk advisory.
- Corpus drift check: passed; counts remain intentionally `null`/unverified.
- Root npm audit: 0 vulnerabilities on this branch.
- Runner npm audit: 0 vulnerabilities on this branch.
- Dependency resolution: Monaco and jsPDF paths resolve `dompurify@3.4.12` on this branch.
- Public GitHub alerts: 3 open DOMPurify alerts (1 medium, 2 low) on the default branch.
- Frontend provider smoke: `https://practice-czarflix.netlify.app/` returned HTTP 200.
- Custom frontend and runner DNS: unresolved; live grading unverified.
- Current-tree gitleaks scan with full redaction: 0 findings.
- Bounded all-ref gitleaks scan (`--all`, 5 MB per-file bound, full redaction): 7 generic signatures, all in initial commit `a445c2a8dcdd`, at `.env.example`, `check_missing.mjs`, two legacy handoff documents, and `test_db.mjs`. Value-free shape checks classified them as Supabase publishable keys, record identifiers, or an explicit password placeholder; no privileged credential was identified and values were never displayed.

Determinism review: tests use no network, sleeps, shared database, or execution-order state. Random schema/check identifiers are asserted by shape and uniqueness rather than by fixed values.

Browser warning: no product UI code changed. The frontend provider was checked by unauthenticated HTTP request; authenticated product behavior and live grading were not claimed or browser-tested.

## Failure Classification

### Branch-caused

None observed.

### Unrelated or preexisting

- Vite large-chunk advisory; build succeeds.
- Public default branch retains three DOMPurify alerts until the corrected branch lockfile is merged.
- Custom frontend and runner hostnames do not resolve.
- GitHub homepage metadata remains empty.

### Inconclusive / externally blocked

- The new RLS migration is not applied or integration-tested against the hosted Supabase project.
- Hosted runner health and execution are unverified.
- Corpus totals cannot be verified without tracked source datasets or a sanitized reproducible export.
- No privileged historical credential was identified. Supabase publishable keys are designed for browser distribution and are constrained by database authorization/RLS; they are not service-role secrets. History rewriting is therefore not required for these seven signatures, though normal Supabase key lifecycle controls still apply.
