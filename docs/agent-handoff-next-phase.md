# DSA App - Next Phase Handoff (Self-Contained)

Last updated: 2026-03-05
Workspace root: `/Users/czarflix/Downloads/DSA/dsa-app`

This document is a complete handoff for the next AI agent. It includes current state, known constraints, what is already done, what must be built next, and acceptance criteria.

## 1) Product Goal

Build a high-quality, personal DSA platform for multiple users with:
- 300 roadmap problems (NeetCode + Companion)
- per-user workspace (progress, notes, code versions, runs)
- shared collaboration features (comments + optional shared solutions)
- Python-only execution via hosted runner/judge
- clean, compact, professional UI/UX

## 2) Non-Negotiable UI/UX Constraints

- Keep layout compact and lean.
- Problem page and dashboard should stay within viewport: target **100dvh / 100vw** behavior with internal pane scrolling (not whole-page overflow chaos).
- Avoid horizontal overflow on problem page.
- Keep styling minimal and professional (developer-tool feel), not noisy.
- Keep interaction labels concise and obvious.
- Current app supports theme toggle (dark/light). Preserve that.

## 3) Current Technical Snapshot

### Frontend
- Framework: Vite + React
- Data fetching/cache: React Query
- Editor stack: Monaco + TipTap
- User selection currently local (NOT real auth): sidebar AA/MS toggle

Key files:
- App shell: `src/components/layout/AppLayout.jsx`
- Sidebar (current user toggle): `src/components/layout/Sidebar.jsx`
- Problem page: `src/pages/ProblemDetailPage.jsx`
- Problem bundle query: `src/hooks/useProblemBundle.js`
- Study order utils: `src/lib/problem-utils.js`
- Supabase client: `src/lib/supabase.js`

### Backend Runner
- Live endpoint: `https://runner.czarflix.me`
- Runner is deployed and healthy.
- Judge integrated (Judge0).
- Python typing fix is live (`List[int]` works without user import).

Key files:
- `runner-service/src/server.mjs`
- `runner-service/src/harness.mjs`
- `runner-service/src/judge0.mjs`

### Database
Supabase has multi-user upgrade and trigger-based solved-state reconcile active.

Applied/important migrations:
- `supabase/migrations/202603040001_dashboard_db_upgrade.sql`
- `supabase/migrations/202603040002_problem_content_and_runner.sql`
- `supabase/migrations/202603040003_multi_user_upgrade.sql`
- `supabase/migrations/202603050001_code_runs_progress_reconcile_trigger.sql`

Trigger active:
- `trg_code_runs_reconcile_progress`

Meaning:
- `progress.status = solved` iff at least one passed `submit` run exists in `code_runs` for same `(user_key, problem_lc)`.
- deleting last passed submit run flips status to unsolved server-side.

## 4) Current Data Ownership Model (Important)

### Shared tables (global dataset)
- `problems`
- `problem_content`
- `problem_test_cases`
- `app_users`

### User-scoped tables
- `progress`
- `solutions`
- `notes`
- `resources`
- `targets`
- `code_runs`
- `user_problem_overrides`
- `study_events`

Current behavior consequence:
- If one user adds/edits rows in `problems`, it is visible to all users.
- Workspace entities are isolated by `user_key`.

## 5) Already Fixed Recently

- Runner redeployed and verified live.
- Typing NameError (`List`) fixed in harness imports.
- Result UI clarifies:
  - Evaluator status (passed/failed/error)
  - Judge sandbox status (Accepted/etc)
- Added Stdout tab in problem page result panel.
- Stdout now has grouped view (default) + raw toggle.

Why `Judge Accepted` + `failed` can both appear:
- Judge Accepted = code executed in sandbox.
- Evaluator failed = output mismatch against tests.

## 6) High-Priority Remaining Work

## A) Problem Next/Back Navigation (Study Order)

Requirement:
- Add `Next` and `Back` navigation on `/problem/:lc`.
- `Next` should follow study order:
  1. same tier/phase until exhausted
  2. next phase
  3. next tier
- At last problem in full order: hide/disable `Next`, show only `Back`.

Implementation notes:
- Use existing study order logic in `sortByStudyOrder` from `src/lib/problem-utils.js`.
- Build full ordered list from shared `problems` via `flattenProblems(...).sort(sortByStudyOrder)`.
- Compute current index by `lc`.
- Add memoized navigator object in Problem page/hook:
  - `prevLc`, `nextLc`, `isFirst`, `isLast`, `position`.
- Keep no page overflow regressions.

Acceptance:
- Traverses entire 300-problem sequence correctly.
- End-state behavior works (no broken next).
- No layout break at narrow widths.

## B) Real Supabase Auth (replace local user toggle)

Requirement:
- Move from local AA/MS switch to real Supabase authentication.
- Support at least email/password login.
- Keep data separation strict.

Current limitation to remove:
- `src/lib/supabase.js` has `auth: { persistSession: false }`.
- Sidebar user switch is local only.

Proposed model:
1. Add mapping from Supabase auth user to app user key.
   - Add column: `app_users.auth_user_id uuid unique references auth.users(id)`.
2. On login, resolve current app user row by `auth_user_id`.
3. Replace local `userKey` source with authenticated identity.
4. Remove user-switch buttons from sidebar for normal users.
5. Enforce RLS for user-scoped tables.

RLS scope rules (target):
- user-scoped tables: user can only read/write rows where `user_key = current_user_key()`.
- shared dataset tables: read allowed for authenticated users.
- writes to shared dataset restricted to admin role (or disabled in app by default).

Acceptance:
- User session persists refresh/reopen.
- Ayaan cannot see Mantsha workspace rows and vice versa.
- Shared dataset still visible to both.

## C) Shared Comments per Problem

Requirement:
- Add comments component on problem page.
- Any user can post comments on a problem.
- Other user can see comments.
- Author-only edit/delete.

Suggested DB table:
- `problem_comments`
  - `id bigserial primary key`
  - `problem_lc int not null`
  - `author_user_key text not null references app_users(user_key)`
  - `content text not null`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

Indexes:
- `(problem_lc, created_at desc)`

RLS:
- `select`: authenticated users can read all comments
- `insert`: only with `author_user_key = current_user_key()`
- `update/delete`: only where `author_user_key = current_user_key()`

UI behavior:
- Add left-pane `Comments` tab (or equivalent compact section).
- Chronological thread, compact rows, timestamp + author badge text.

Acceptance:
- Both users can read each other comments.
- Only author can mutate own comments.

## D) Shared Solutions (read-only for others)

Requirement:
- Allow user to mark solution as global/shared.
- Other users can view/load it, but cannot edit/delete owner's shared artifact.
- Clicking shared solution should prefill code editor (as local copy/version).

Important decision:
- Use dedicated table rather than mutating `solutions` semantics.

Suggested table:
- `shared_solutions`
  - `id bigserial primary key`
  - `problem_lc int not null`
  - `author_user_key text not null references app_users(user_key)`
  - `title text not null`
  - `code text not null`
  - `language text not null default 'python'`
  - `source_solution_id int null`
  - `source_run_id bigint null`
  - `runtime_ms int null`
  - `memory_kb int null`
  - `tests_passed int null`
  - `tests_total int null`
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

Indexes:
- `(problem_lc, created_at desc)`
- `(author_user_key, problem_lc)`

RLS:
- `select`: all authenticated users
- `insert/update/delete`: only author row owner

UI behavior:
- In problem page, add `Shared` section under Solutions tab.
- For own solution/run: `Share` action.
- For shared entries: `Load to Editor` action creates local version in `solutions` (user-scoped), do not edit shared row.

Acceptance:
- shared visibility works cross-user.
- edit protection works.
- one-click load works.

## 7) Split-Brain / Staleness Guardrails

Goal: avoid state mismatch between UI and DB.

Current observation:
- Query invalidations are already present in key mutate paths.
- Query defaults use 5m staleTime and no refetch-on-focus.

Recommended adjustments:
1. Keep trigger as source of truth for solved/unsolved.
2. After run/submit/delete run:
   - always refetch `problem-bundle`
   - invalidate `progress` and dashboard dependencies.
3. For cross-session freshness, consider either:
   - lower staleTime for `progress`/`problem-bundle`, or
   - Supabase realtime subscriptions for critical tables (`progress`, `code_runs`, comments/shared_solutions).

Acceptance:
- deleting last passed submit reflects unsolved on dashboard without manual hard refresh.
- second device/user updates appear reasonably fresh.

## 8) Files Most Likely to Change

Frontend:
- `src/pages/ProblemDetailPage.jsx`
- `src/hooks/useProblemBundle.js`
- `src/components/layout/Sidebar.jsx`
- `src/context/UserContext.jsx` / user store
- new auth pages/components
- new hooks for comments/shared solutions/navigator

Data layer:
- `src/lib/supabase.js`
- `src/lib/supabase-queries.js`

DB migrations (new):
- add auth mapping + RLS policies
- add `problem_comments`
- add `shared_solutions`

## 9) Suggested Execution Order

1. Add navigator (Next/Back) first.
2. Add auth foundation (session + user mapping + RLS).
3. Add comments feature.
4. Add shared solutions feature.
5. Final polish + regression pass (viewport/layout + no overflow).

## 10) Regression Checklist (must pass)

Problem page:
- no horizontal overflow at common laptop widths
- pane collapse/expand still stable
- next/back navigation order correct
- run/submit still works for runnable problems
- 27 non-runnable problems still show editor and disabled run/submit messaging
- stdout grouped/raw toggle still works

Data correctness:
- run submit passed => solved
- delete one of many passed submits => still solved
- delete last passed submit => unsolved
- dashboard and problem list reflect current status

Auth/separation:
- user A cannot edit user B scoped records
- user A and B both read comments/shared solutions
- shared dataset is common

## 11) Copy-Paste Prompt for Next AI Agent

Use the following prompt exactly:

---
You are taking over an existing DSA app codebase at `/Users/czarflix/Downloads/DSA/dsa-app`.

Read this handoff first: `/Users/czarflix/Downloads/DSA/dsa-app/docs/agent-handoff-next-phase.md`.

Critical constraints:
- Keep UI lean, compact, professional.
- Keep key pages within viewport (`100dvh` style), with internal scrolling and no horizontal overflow regressions.
- Preserve existing functionality: runner integration, grouped/raw stdout, solved-state reconcile behavior.

Current architecture facts:
- Runner backend is live at `https://runner.czarflix.me`.
- Supabase has multi-user schema and `code_runs -> progress` reconcile trigger active.
- Frontend still uses local AA/MS switch (not real auth yet).
- Shared dataset tables: `problems`, `problem_content`, `problem_test_cases`, `app_users`.
- User-scoped tables: `progress`, `notes`, `solutions`, `resources`, `targets`, `code_runs`, `user_problem_overrides`, `study_events`.

Implement in this order:
1) Problem Next/Back navigation on `/problem/:lc` using study order from `sortByStudyOrder`.
   - Next rolls through phase then tier naturally.
   - At end, no next action.
2) Supabase Auth (real session-based identity) + user mapping + RLS.
   - Add `app_users.auth_user_id` mapped to `auth.users.id`.
   - Replace local user switch in sidebar.
3) Shared problem comments.
   - Create `problem_comments` table.
   - Both users read; author-only edit/delete.
4) Shared solutions.
   - Create `shared_solutions` table.
   - User can share own solution; others read-only.
   - Clicking shared solution must load code into editor as local editable copy/version.

Do not skip validation:
- Run lint/build.
- Verify run/submit/delete states still reconcile.
- Verify no viewport overflow regressions.
- Verify separation rules across two users.

When done, provide:
- migration SQL files created/applied
- exact files changed
- manual test steps and outcomes
- any residual risks
---

