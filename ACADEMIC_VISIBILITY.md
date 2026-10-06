# Academic-period visibility

Implemented on `wip/renal-anatomy-practical`, starting at `8ffad9563f1c0a6ee873d101ca3f256e3e7ac79c` (2026-10-03).

## Authoritative configuration

`academic_period` already has `academic_year` (calendar cohort label), `type`, `starts_at`, `ends_at`, and `active`. Modules have the explicit `academic_period_id` foreign key. `study_year` is the student's curriculum year, not the calendar cohort label.

Only that foreign key determines a module's academic period. No dates, associations, or Summer classifications are inferred from term numbers, slugs, filenames, titles, or folders. No schema or content data changes were needed.

These columns are PostgreSQL `timestamp without time zone`. The server reads raw timestamp text and compares it with server time formatted in `Africa/Cairo`, consistent with existing scheduling/analytics. Admin inputs explicitly use Cairo wall time (including seconds/milliseconds); explicit-offset API inputs are converted to Cairo before storage. This avoids the ORM's UTC reinterpretation of wall timestamps and host/client timezone parsing. The student's clock is never used for visibility.

## Rules

- Enabled regular periods: hidden before start; available for historical discovery after start, even after end.
- Dashboard and weekly plan: only current periods, with current-period accuracy, continuation, module list, review count and recent quizzes.
- Modules/Curriculum: current first, then previously started regular periods. Term/year choices come from visible records, not all database years or invented term pairs.
- Summer: active dates only, never during an overlapping ordinary term in the same academic year. No inactive/empty Summer advertising. Existing Summer retake pricing/purchase calculations are unchanged.
- Missing/deleted/invalid association or invalid period: student discovery/access fails closed. No guessed fallback year or dates.
- Admin: bypasses student visibility restrictions; management endpoints remain unfiltered and admin-only. Academic Periods shows missing-association/invalid-date/overlap warnings.
- Visibility is enforced before module entitlement and before first-lecture preview. Subscription ownership cannot open a future period. Existing entitlement, ownership and historical-content rules still apply.
- Period configuration/visibility is never TTL-cached. React request-local memoization does not persist across requests, start/end boundaries or admin edits. Modules no longer consumes the long-lived curriculum cache.

## Direct-request protection

Central `learning-access.ts` guards cover lecture PDFs/source study cards, notes, tutor, flashcard/case generation and private records, quiz questions/answers/bookmarks, reviews, battles, Practical tracks/images and OSPE folders/exams. Lecture/module/quiz page loaders also reject hidden records before rendering titles/content. OSPE discovery hides future folders instead of rendering them locked. Pricing and price/Summer-preview endpoints filter discovery only, including manual plan/module IDs; price calculations, billing/subscriptions and stored plan records were not changed.

## Actual local configuration (read-only)

- 44 modules; 394 lectures, unchanged before/after this task.
- 10 modules explicitly associated: 5 Term 1, 5 Term 2.
- 34 modules have no academic period association. They are now hidden from students until the owner explicitly configures their associations; no automatic backfill was run.
- No module is associated with Summer. The configured Summer interval overlaps Term 2 in July 2027, so Summer is hidden during that overlap. Admin warning identifies it; dates were not edited.
- Existing university/faculty requirement visibility WIP and unrelated pricing/curriculum changes remain local and uncommitted. This task stages only its own hunks in overlapping pricing/quiz files.

## Verification

62 added deterministic tests cover Cairo/DST midnight boundaries, all requested Term 1/2/Summer cases, historical access, admin bypass, missing configuration, database-ID association resolution, entitlement/preview non-bypass, filtered selectors/loaders, price/Summer-preview access, and actual component SSR at three fixed dates. The weekly API test mocks the request cookie and visible years.

Full working-tree suite: 930/930 tests in 75 files. Typecheck passes; lint has 0 errors (197 existing warnings); build passes (9 existing filesystem-tracing warnings). The full gates include preserved unrelated local WIP; they are not a claim that this task committed that WIP.

Authenticated live Edge QA: Dashboard/Modules/year selector/weekly plan/pricing at the actual Term 1 date. Future module, lecture and PDF return 404; notes return 403; future-module search returns 200 with zero results. No unexpected browser console errors or failed application requests. Desktop/375px, light/dark: no horizontal overflow.

Term 2 and Summer were checked with server-rendered fixed-date fixtures of the real Dashboard/ModuleList/selector and application CSS in Edge, not live end-to-end future sessions. No DB dates, machine clock or runtime authorization clock override was introduced. Admin login was not attempted; admin bypass/config-warning behavior was covered by tests/code inspection.

Details: `reports/academic-visibility-qa.json`. Screenshots/fixture HTML remain local under `tmp/academic-visibility-qa/` and are not committed.

To repeat controlled browser QA: set `ACADEMIC_QA_RENDER=1`, run `npm test -- src/components/academic-visibility-ui.test.ts`, unset it, then run `node scripts/qa-academic-visibility.mjs`. Use existing legitimate local test credentials; this script does not seed/reset/create users, change approvals, or write curriculum.

Database/curriculum/PDF mappings modified: **NO**. No migrations or imports executed. Ordinary legitimate login can create an authentication session.
