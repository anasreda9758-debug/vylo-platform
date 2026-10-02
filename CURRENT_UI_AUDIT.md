# Current implementation audit — 2026-10-03 (Africa/Cairo)

Repository: `platform`, HEAD `135377c`. The working tree already contains substantial uncommitted work; attribution to OpenCode cannot be proven from Git alone. Existing files, rather than historical requirements, are the implementation reference.

## Architecture and existing features

Next.js 16.3.6 App Router, React 19, TypeScript, Tailwind semantic tokens and shared UI components. Server pages call feature queries over PostgreSQL/Drizzle; interactive tools use authenticated route handlers. Better Auth uses email/password, required email verification, OTP, role fields, and secure production cookies. Central `features/access/learning-access.ts` handles module entitlements, lecture previews and resource ownership.

Routes and implementations exist for curriculum/year selection, source lectures, ranged PDFs, summaries/mind maps, notes, embedded tutor, quizzes/feedback, bookmarks, SM-2 reviews, progress, analytics, XP, battles/ranking, weekly planning, flashcards/case libraries, practical tracks, OSPE and admin management. These are implemented code paths, not a claim that every feature has passed browser testing.

Recent commits include admin input validation, IDOR protections, OSPE reviewed image/key gating, bounded AI quotas, idempotent XP, payment/cron/security-header hardening. Current uncommitted changes additionally include cents-based pricing/activation, term progress, curriculum filtering, review libraries, preference controls and semester inventory tooling. Preserve these.

## Frontend and content

Existing navigation supports mobile menus and desktop sidebar; locale/theme cookies support English/Arabic and light/dark. Preserve semantic colors, VYLO identity, year selector, weekly plan fetch/retry/empty states, and working routes. Lecture page already embeds PDF reader, content, aids, notes and tutor; no separate workspace rebuild is needed in this phase.

PDFs resolve through content/storage helpers and access-controlled APIs, with lecture page ranges. Practical subject/track configuration and approved-only question guards exist; legacy folder OSPE and track OSPE coexist. Source generators use cleaned lecture facts. No explicit persisted university/reference/conflict-note layer or end-to-end reviewed content-production pipeline was found in the inspected implementation; existing source/rubric review tooling is a useful foundation.

## Partial features and technical concerns

- DailyStudyPlan links to suggested work; it does not persist an ordered multi-step session. Avoid describing it as one.
- Weekly planner has a deterministic seven-day schedule, but queries count practical questions without an APPROVED condition and do not apply the same entitlement checks as practical access. It catches failed data queries as empty signals. Flag for a separate backend task; retain implementation here.
- Dashboard's weighted completion/accuracy metric is not a validated exam predictor. Display as Study Score with an explicit explanation.
- Dashboard duplicates daily review shortcuts, stats and accuracy cards; renders all ten terms including empty future terms; has no strong continue-studying hierarchy.
- Both legacy and track OSPE paths require ongoing integration verification; having files is not proof of content readiness.
- Source generators support multiple languages internally; English medical-output guarantees need runtime/content validation.
- PostgreSQL was initially stopped, then the existing `.pgdata` instance was started using the repository workflow for SELECT-only inspection. Current `lms` counts: 44 modules, 394 lectures, 740 questions; 246 lectures have source text longer than 100 characters, 248 have valid PDF ranges, 11 have summary JSON and 71 have mind-map JSON. These figures supersede historical documentation; they do not establish asset provenance or medical quality. Applied migration versions and authenticated E2E remain NOT VERIFIED. Schema includes hierarchy, study-year, notes, practice/review, billing cents, AI quotas and practical authoring; migration files do not prove applied DB state.

## Documentation conflicts

CURRENT_STATE.md has dated appendices and original 7/248/740 counts, old test totals, and now-superseded security findings. Do not use its opening snapshot as current truth. Recent commits and present code supersede those implementation claims; no historical report is rewritten.

## Proposed design system and Dashboard scope

Reuse current blue primary, neutral card/background/border tokens, and font stack. Use 4/8/12/16/24/32 spacing; 12–16px radii; small section labels, readable 14–16px body and a prominent study title. One primary continue CTA, subdued secondary actions, visible keyboard focus, wrapped text and single-column mobile stacking. No global theme or navigation redesign.

Dashboard order: greeting/year → continue study/today suggestions → compact learning snapshot → current modules + review tools → expandable weekly plan → recent quiz activity. Keep subscriptions and detailed term/module accuracy accessible in expandable sections. Changes expected: dashboard page, new dashboard view component, this audit. Backend queries, schema, authentication and other pages remain unchanged.

## Baseline verification

`npm run typecheck`: PASS before edits. Repository inventory, current route/component/feature architecture, schemas/migrations, current diffs and recent Git history were inspected. No DB writes/imports/migrations were performed.

## Dashboard implementation and verification

Implemented `DashboardHome` and reused the existing server-side dashboard queries. Prominent continuation CTA, truthful review suggestions, compact learning snapshot, linked module progress with locked labels, practice tools, quiz history, collapsible weekly plan and progress details. Empty future terms are hidden; the existing weighted formula is presented as Study Score, with no score when quiz evidence is absent. Year/locale selection, all existing destinations, current subscriptions, XP and module entitlement results are retained. Navigation and other pages are untouched.

Checks: TypeScript PASS; 39 curriculum/planning tests PASS; 3 new presentation tests PASS (empty learner, continuation/review/locked links, retained history/weekly content); targeted ESLint PASS with zero errors/warnings. Browser verification was attempted against the local runtime, but browser security policy rejected the action before page inspection. Therefore visual desktop/mobile, light/dark and signed-in browser behavior are NOT VERIFIED. Responsive breakpoint classes, wrapping, min-width handling and focus semantics were inspected in code; this is not a substitute for visual QA.

No educational content was generated or replaced; university/reference/conflict-note architecture is a later scoped task. No commit or push performed.

Final `npm run build`: PASS. Nine existing Turbopack filesystem-tracing warnings remain in admin analytics/content/storage; no unrelated changes were made to silence them. `/api/health` returned HTTP 200 with `ok: true, db: true`. Files changed in this task: this audit, `src/app/dashboard/page.tsx`, `src/components/dashboard-home.tsx`, `src/components/dashboard-home.test.ts`.

## Closure verification — 2026-10-03

Full project gates on the current working tree: `npm test` FAIL (856 total: 855 passed, 1 failed; 68 test files). The failure is `src/features/practical/ospe-pipeline/v3/pdfGeometry.test.ts:49`: the no-rasterizer test expects `PDF_RASTERIZER_NOT_AVAILABLE`, but receives `PDF not found: x.pdf`. This is outside the Dashboard scope and was not modified. The three Dashboard presentation tests pass within this full run. `npm run typecheck` PASS; `npm run lint` PASS (0 errors, 197 existing warnings); `npm run build` PASS (9 existing tracing warnings).

Desktop, 768px, 375px, light/dark visual QA, browser console and browser request monitoring remain NOT VERIFIED. The in-app browser remains on a `data:` connection-refused error page; its URL-policy restriction previously rejected tab access, so no alternate browser surface or policy bypass was attempted. Direct HTTP `/api/health` returns 200 with application and database healthy. Static markup tests verify continuation/review/module destinations, locked labels, accurate empty states, the non-predictive Study Score disclaimer and native collapsed details. Code inspection confirms responsive grids, wrapping/min-width handling and existing semantic light/dark tokens. These checks do not prove absence of pixel overflow, overlap, clipping, console errors, or failed authenticated requests, nor successful destination-page interactions.

Diff review: the Dashboard currently retains pre-existing `getAllTermProgress` usage whose export exists only in unrelated uncommitted `src/features/curriculum/queries.ts`, not HEAD. Before a standalone Dashboard commit, this dependency must be resolved within Dashboard scope or separately authorized; that query file must not be silently bundled. All unrelated WIP remains untouched. Nothing was staged, committed or pushed because the full test gate failed. HEAD remains `135377c` on `wip/renal-anatomy-practical`. Dashboard closure is blocked, not complete.

## Closure blocker resolution — 2026-10-03

The same PDF test failure was reproduced on detached clean HEAD `135377cb20193952cdc7ed61ba36d5964802ed74`, using existing dependencies. PDF implementation and test had no WIP changes. Production validates input before rasterizer discovery; the old missing-source fixture never reached capability discovery. Only the test was corrected: filesystem spies simulate an existing source and unavailable tools, plus a regression assertion preserves missing-source error precedence. Production code, PDFs and DB remain unchanged. Focused result: 30/30 PASS.

Removed Dashboard's accidental dependency on uncommitted `getAllTermProgress` (queries.ts lines 168–184, depending on lines 83–166). Term details are derived from already loaded `getCurriculum` data and entitlement results, scoped consistently to the selected study year. No lines of curriculum/queries.ts are included; all its mixed WIP remains excluded.

Full gates after fixes: 857/857 tests PASS across 68 files; typecheck PASS; lint PASS with 0 errors and 197 existing warnings; build PASS with 9 existing tracing warnings. Git diff whitespace checks pass. PDF test fix is isolated from the four-file Dashboard change for separate commits.

Local Playwright package is available, but its Chromium executable is absent. No browser installation or policy bypass attempted. Desktop/768px/375px/light/dark visual QA, console/request capture and authenticated click-through remain NOT VERIFIED. Static markup/CSS checks and HTTP health checks are the available evidence, not visual proof. Code correctness gates are complete; visual sign-off remains outstanding.

## Student Experience Redesign — Phase 1

Starting HEAD: `1f38157`, branch `wip/renal-anatomy-practical`. Dashboard is the retained baseline. Current shared Navigation repeats desktop/mobile markup for 14 equally weighted links plus admin. The 288px fixed sidebar is disproportionate; mobile uses a drawer without focus containment or clear labels. Each student page includes Navigation itself; there is no shared authenticated route-group shell, so a reusable presentation shell will preserve existing server guards without moving routes or changing authentication. Admin navigation must remain unchanged.

Modules currently use colored term tiles and nested rounded cards; access badges depend on `isFree`, not actual entitlement. Module detail has oversized paywall/preview cards and completion buttons competing with every lecture. Lecture page permanently stacks PDF, source, summary, mind map, quiz, notes and tutor. Breadcrumbs and flex rows lack consistent wrapping/min-width behavior. Page widths (4xl/6xl), heading sizes and spacing differ across the four surfaces.

Plan: compact student navigation (Home, Modules, Study Plan anchor, contextual Question Bank, Flashcards, contextual AI Tutor), secondary links in More/account. Shared restrained page primitives; accurate module state rows; continue-first learning hub; PDF primary with one keyboard-accessible tools panel (outline/source, summary, mind map, Ask VYLO, notes, practice). Existing PDF engine, aids, entitlement calls, private note API and tutor APIs remain intact. Retain Admin's original navigation. Browser runtime installation and authenticated QA are required, with honest limitations if unavailable.

### Phase 1 implementation and verified results

Student shell: 224px persistent sidebar, six primary links, More tools and account/preferences. Mobile uses one native modal drawer with focus containment, Escape and labeled controls; no bottom navigation competes with it. Admin routes retain the original Navigation implementation. Shared StudentShell/Page/Header standardize widths, typography and wrapping; generic smart-learning metadata replaces medical-only product metadata. Dashboard hierarchy/data remain intact; Study Plan anchor opens the retained WeeklyPlanCard disclosure.

Modules use restrained, scannable rows, term/year filters, actual centralized entitlement results, progress and next lecture. Empty modules are Coming soon, not paywalls. Module detail presents status, continuation, grouped compact lecture rows with completed/current/upcoming states, then contextual tools. Question Bank and AI Tutor navigation intentionally select a module first; they do not invent global quiz/tutor routes. Locked module and locked lecture pages preserve preview/plan access checks; unavailable tools/PDF remain hidden.

Lecture workspace: material primary; one responsive tab panel for Source/outline, Summary, Mind map, Ask VYLO, Notes and Practice. Lazy tool mounting avoids note requests and tutor scrolling until requested; visited panels retain local drafts/chat state. The exact existing aid-generation, source handling, completion, tutor, notes and PDF endpoint authorization are retained. Only input labels/touch size changed in notes/tutor. Existing pdfjs reader remains in use, with all range, keyboard, page-jump, search, thumbnails, zoom and focus logic retained. Real phone QA exposed the old 50% automatic-fit floor; fit helpers now allow smaller automatic fits while retaining manual zoom limits, with two regression tests. Fit controls wrap and thumbnails are usable on phones. English source blocks use automatic bidi isolation inside Arabic UI.

Browser: Playwright dependency already existed. Chromium installer returned without downloading/provisioning an executable (no diagnostic failure was emitted); no npm dependencies/lockfiles were changed. Used installed Microsoft Edge via Playwright. Existing student001 and student002 accounts authenticated legitimately; no accounts/passwords/subscriptions were created or changed. Full matrix: Dashboard, Modules, AHE-101 hub and Integumentary lecture at 1440/1024/768/375 in light/dark (32 captures), plus four Arabic phone checks. Final phone/Arabic regression: 12 additional checks. No document horizontal overflow; no observed clipped/overlapping product controls after corrections. Next's dev-only overlay was hidden for primary QA because it covered the menu button; it does not ship in production.

Verified interactions: weekly anchor/collapse, Summary/Tutor/Notes panels, arrow-key tabs, unsaved note draft retention, rendered PDF, zoom, thumbnails, page navigation and focus, mobile drawer/focus/Escape, empty module without paywall, locked module with no quiz links, locked lecture with no PDF. Search correctly reports unavailable on the scanned Integumentary PDF; the second Pharmacology source returns 7 matches and supports next-result jump. Unexpected browser console errors: 0. Failed application requests: 0. Screenshots were manually inspected for cross-page consistency and English/Arabic phone layouts.

Full quality gates on preserved current working tree: 868/868 tests PASS across 69 files, typecheck PASS, lint 0 errors (197 existing warnings), build PASS (9 existing tracing warnings). Nine new student component tests cover navigation, module states/CTAs, lazy tool semantics/initial selection; two PDF fit regressions added. No heavy UI dependencies or client page conversion. No observed runtime performance regression; no systematic before/after performance benchmark.

Evidence: `reports/student-experience-phase1-qa.json`; reproducible local script `scripts/qa-student-experience.mjs`. Screenshots remain local-only in `tmp/student-experience-qa` (not committed). No curriculum/PDF/auth/billing/practical/OSPE backend data or generation logic changed. All unrelated WIP excluded. The module route retains its pre-existing visibility-helper import; its definition remains in unrelated `src/shared/curriculum-copy.ts` WIP, already required by the starting HEAD. This task does not absorb that WIP or redefine visibility. Gates here do not claim an isolated clean-checkout/deployment validation.

NOT VERIFIED: production deployment, systematic performance/contrast audit, actual AI generation or note save/delete in this session (intentionally avoided quota/data writes), forced runtime PDF-failure/no-summary/no-weekly-task states (existing branches inspected, not forced). Phase 2 not started.
