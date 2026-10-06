# VYLO Admin loading fix report

2026-10-03, Africa/Cairo. Starting branch wip/renal-anatomy-practical.
**Main frontend bug fixed and regression-tested. Authenticated browser closure is still incomplete; no claim that every tab was opened.**

## Requested results

| # | Item | Result |
|---|---|---|
| 1 | Starting HEAD | cd783a7e83b1651b0ec5c3a582dfbd2238526eb0 |
| 2 | Bug reproduced | YES in deterministic execution of the original real hook before modifying product code: 24/25 tests failed, including all 15 analytics views. NOT reproduced in an authenticated browser because no usable Admin session was available. |
| 3 | Exact root cause | useAdminData set its unmounted.current flag true when mounted. Every success/error/finally callback returned early, discarding JSON and never setting loading=false. Curriculum module expansion separately did not call fetchLectures. |
| 4 | Affected tabs | All 15 useAdminData analytics views and header System badges; Curriculum expanded lecture list also stalled. Four management list paths had swallowed/unhandled failed reads. |
| 5 | API/route | /api/admin/analytics?view=... was not proven broken: frontend ignored responses. Curriculum /api/admin/lectures request was never started on expansion. |
| 6 | Original HTTP/error | Reproduced with successful HTTP 200 JSON, 401/403/500/504, network and timeout fixtures: state remained [null,true,null]. Actual original authenticated HTTP status/body/console stack NOT CAPTURED. Root bug needs no server error. |
| 7 | Files changed | Eight exact task files listed below. No authentication file changed. |
| 8 | Backend fix | NONE required: read-only real DB probes of 17 analytics sources all completed (1–147ms), including Overview and Years 1–5. Server guards and query behavior untouched. |
| 9 | Frontend fix | Per-effect unmounted=false; cleanup sets true, cancels request and timer. Obsolete effects cannot revive on Strict Mode restart. Management reads have bounded timeout/safe errors; curriculum expansion starts the authorized GET and exposes empty/error/retry states. |
| 10 | Security regression involved | NO demonstrated security-policy regression. Admin data paths do not use student release/entitlement gates. Those four Admin files were unchanged between 13e68fd and cd783a7; hook history predates them. |
| 11 | Overview | PASS hook + route + render tests; real DB source 96ms; browser NOT VERIFIED |
| 12 | Users | PASS hook + route + render tests; real DB source 4ms; browser NOT VERIFIED |
| 13 | Subscriptions | PASS hook + route + render tests; real DB source 2ms; no payment config required or activated; browser NOT VERIFIED |
| 14 | Content Health | PASS hook + route + render tests; real DB source completes; browser NOT VERIFIED. Probe verifies completion, not certification of every displayed aggregate. |
| 15 | Curriculum | Expansion bug repaired; safe module/lecture read handling. Real module/lecture source queries complete; browser NOT VERIFIED |
| 16 | Exams/Quiz | PASS hook + route + render tests; real DB source 2ms; browser NOT VERIFIED |
| 17 | Practical | PASS analytics tests and read-only source 3ms; no questions generated/approved; browser NOT VERIFIED |
| 18 | OSPE | PASS analytics tests and source 1ms; no stations/mappings/approval changed; browser NOT VERIFIED |
| 19 | Review | PASS analytics tests and source 4ms; owner/private-content controls retained; browser NOT VERIFIED |
| 20 | Additional tabs | Learning, AI, XP, Activity, Payments, Audit, System: hook/route/render tests PASS and read-only sources complete. Promos, Redeem, Academic Periods: existing Admin GET guards inspected; bounded read/error handling added. All extra browser checks NOT VERIFIED. |
| 21 | Anonymous /admin | Live IAB navigation redirected to /sign-in. Analytics every-view tests 401. |
| 22 | Student /admin | Existing requireAdmin server redirect retained; all analytics-view tests 403. Real Student browser NOT VERIFIED. |
| 23 | Admin /admin | Existing server guard accepts role admin; all analytics-view route tests 200. Owner reports legitimate normal-browser login works; independent authenticated Admin browser NOT VERIFIED. |
| 24 | Years 1–5 | PASS real read-only content source returns [1,2,3,4,5]; route regression confirms all years without student entitlement. |
| 25 | Modules before/after | 44 / 44 |
| 26 | Lectures before/after | 394 / 394 |
| 27 | Questions before/after | 740 / 740 |
| 28 | Tests added | 35: real-hook lifecycle/management-read tests 30 plus analytics authorization/year/error tests 5 |
| 29 | Total tests | PASS: 1234 / 85 files, current working tree including preserved unrelated WIP |
| 30 | Focused security | PASS: 314 / 16 security files. Admin-focused tests 95 / 3 files also PASS. |
| 31 | Typecheck | PASS, after build |
| 32 | Lint | PASS, 0 errors / 197 pre-existing warnings |
| 33 | Build | PASS; nine existing filesystem-tracing warnings. No remote deployment performed. |
| 34 | Desktop browser | NOT VERIFIED: internal browser reached sign-in, no Admin session |
| 35 | Mobile browser | NOT VERIFIED for same reason; no false visual PASS |
| 36 | Console errors | No authenticated Admin console capture possible. Internal sign-in visibly reports Invalid email or password; no credential values read or exposed. |
| 37 | Network/API errors | No authenticated Admin request trace available. All real analytics source probes complete; diagnostic harness failures were corrected, not product errors. Exact differing sign-in request responses still owner evidence required. |
| 38 | DB/schema | NO changes; read-only transactions only |
| 39 | Data | NO agent changes to users, credentials, roles, subscriptions, curriculum, PDFs, dates, pricing, approvals or payments |
| 40 | WIP | Preserved; all 26 original tracked WIP SHA-256 hashes unchanged; unrelated untracked files excluded |
| 41 | Commit | Created after report/gates; exact SHA in final handoff/git log -1. Message: fix: restore admin control center data loading |
| 42 | Push | Normal current-branch push; final handoff reports actual outcome. No merge. |
| 43 | Remaining issue | Need usable legitimate Admin session to open all 19 tabs at desktop/mobile and verify console/network. Authentication difference diagnosis is below; no reset or auth changes made. |

## Complete current tab and route inventory

The UI has **19 tabs**, not only those initially visible in its horizontally scrolling tab bar:

- Overview, Users, Subscriptions, Content Health, Quiz/Exams, Practical, OSPE, Review, Learning, AI, XP, Activity, Payments, Audit, System → /api/admin/analytics with the corresponding view; server getSession + explicit role=admin gate before DB work.
- Curriculum → /api/admin/modules and /api/admin/lectures?moduleId=...; explicit server Admin guard; no student year/subscription filters. Existing CRUD/reorder remains unchanged and was not invoked.
- Promos → /api/admin/promo-codes; authenticated Admin guard.
- Redeem → /api/admin/redeem-codes; requireAdminApi.
- Academic Periods → /api/admin/academic-periods; session/Admin guard.
- Subscription management actions use /api/admin/subscriptions; no activate/deactivate action executed. Existing additional analytics expiring/plans/detail endpoints remain unchanged.

Existing server analytics timeout, structured safe HTTP 500/504, isolated non-critical Overview fallbacks, intended empty states and render contracts retained. The fix does not force loading off to conceal API errors: successful data is consumed, error statuses/network/JSON/timeout are surfaced safely. No non-critical child query was newly discarded.

The standalone real-source probe invoked only inspected aggregate functions inside READ ONLY transactions, returned timings/statuses only (no users, subscriptions, answers or secrets), and restored its process-local execute adapter after each call. It is NOT a browser or HTTP authorization test.

## Requested authentication-difference diagnosis — no auth modification

Owner reports fresh manual Admin sign-in succeeds in the normal browser but fails in IAB. IAB currently visibly shows Invalid email or password.

Verified:

- IAB is on http://localhost:3000/sign-in. Local localhost and 127.0.0.1 /api/health both return 200 with ok/db true; one local Node listener owns port 3000 on ::. The normal browser's exact origin/request is owner-reported, not independently captured.
- authClient uses createAuthClient() with no alternate API base URL. The same page submits POST /api/auth/sign-in/email with explicit email/password React state. No browser-dependent authentication branch was found.
- SELECT-only account audit for the owner's identified Admin: exactly one user, admin role, email verified, stored email already lowercase/trimmed, exactly one credential account and nonempty stored password credential. No password/hash/token/cookie was selected or printed.
- seed-admin.ts can promote an existing user without creating a credential, but that missing-credential scenario does NOT match this actual account.
- Better Auth's installed findUserByEmail lowercases the submitted email. The form does not trim email before submitting; the adapter does not trim either. That is an observation, NOT proof that trimming caused this failure.
- Installed Better Auth distinguishes invalid credentials (user/account/password missing or verification mismatch) from EMAIL_NOT_VERIFIED and origin errors. This account is verified, so the verification status is not the demonstrated blocker. A stored password credential exists, but this does NOT prove the password sent by either browser is identical.
- A pre-existing session can redirect the sign-in page via getSession, and autofill can affect values, but no evidence establishes either as the actual cause here.
- Existing auth wrapper logs only method/path/status/duration. No current safe request/response trace was available from the thread terminal or browser dev logs. IAB's supported read-only inspection does not expose a Network response capture. No speculative retry, credential comparison, password inspection or authentication logging change was performed.

**Exact cross-browser root cause: NOT YET PROVEN.** Do not call this an invalid password, autofill bug, cookie bug, origin mismatch or missing credential without the original request evidence.

Owner evidence required: in each browser's Network panel provide ONLY request URL, HTTP status, and response code/message for sign-in/email; confirm a new successful POST exists during normal-browser fresh login. Do NOT share Payload, Headers, password, hashes, cookies or tokens. No authentication change/reset is authorized or performed.

## Exact changed files

1. src/components/admin/use-admin-data.ts
2. src/components/admin/use-admin-data.test.ts
3. src/components/admin-panel.tsx
4. src/components/academic-period-admin.tsx
5. src/components/promo-code-admin.tsx
6. src/components/redeem-code-admin.tsx
7. src/app/api/admin/analytics/route.test.ts
8. ADMIN_LOADING_FIX_REPORT.md

## Integrity and final qualification

Module fingerprint fc8b63113c525326f6e92b02d309e3be.
Lecture fingerprint 5fc7d6b1fa1963d086251c501ccf46b1.
Academic-period fingerprint e29b20ab8e8a68fb9df2f5ba28f983f8.
All unchanged; 44/394/740 retained. No seed/reset/migration/import used.

**B — Main bug fixed; complete authenticated Admin verification remains incomplete.**
This qualified result is NOT verdict A and does not assert every tab is fully functional. The independent authentication difference needs the safe request evidence above before any auth change.

## Authenticated follow-up — 2026-10-03 06:45 Africa/Cairo

Owner successfully signed in with the existing password. The current IAB session opens /admin and identifies admin@vylo.win. Password recovery investigation stopped; no authentication/account modification was made. This follow-up supersedes the earlier browser-session blocker for tab loading only; historical diagnostics above are retained.

Current HEAD: 7fc22b2fde0414de92367fe569618fbe79e5b368, matching the local origin/wip/renal-anatomy-practical tracking ref.

All 19 tabs were opened individually, observed after loading, and opened again:

| Tab | Actual browser result |
| --- | --- |
| Overview | Loaded real aggregate cards; 44 modules, 394 lectures, 740 questions. One second-pass locator wait expired while loading; a subsequent observation showed complete data without an application error. Not an endless spinner. |
| Users | Loaded user table and pagination. |
| Subscriptions | Loaded subscription table and available plans. No subscription action executed. |
| Content Health | Loaded curriculum period, module and lecture health tables. |
| Curriculum | Loaded full module list, including later-year modules. Expanding AEH-101 loaded its 47 lectures. No editor/save/delete/reorder action executed. |
| Exams | Loaded; valid empty analytics for the selected period. |
| Practical | Loaded track, question review/publishing and practice analytics. No approval or content action executed. |
| OSPE | Loaded explicit not-configured state: 0 mapped stations, 759 reference entries. Valid empty exam results; no stations enabled. |
| Review | Loaded due cards and clinical-case summary. |
| Learning | Loaded daily activity and completion analytics. |
| AI | Loaded quota/usage analytics and valid empty generation state. |
| XP | Loaded distribution and leaderboard. |
| Activity | Loaded activity feed. |
| Payments | Loaded explicitly disabled gateway state and valid empty transaction analytics. |
| Promos | Loaded existing code table and creation form; no mutation. |
| Redeem | Loaded existing code table and generation form; no mutation. |
| Academic Periods | Loaded period-management view; no dates or mappings changed. |
| Audit | Loaded valid no-matching-records state. |
| System | Loaded server, database, version and integration health. |

Browser developer-log capture after both passes: 0 errors, 0 warnings. No visible HTTP 401/403/404/500/504, safe-error box, runtime exception or remaining spinner was observed. /api/health independently returned HTTP 200 with db=true during the delayed Overview check.

Network limitation: the supported IAB APIs expose no Network response/HAR capture capability. Successful rendered data and the inspected response.ok/error handling demonstrate settled application reads, but exact HTTP status/timing for every authenticated request was NOT directly captured. Do not describe this as a complete Network audit.

Confirmed newly broken tabs: NONE. New root causes/routes repaired: NONE. Code changes: NONE. Tests added: 0. No tests/typecheck/lint/build rerun because no code changed. Latest existing validation remains 1234 tests / 85 files PASS, 314 focused security tests PASS, typecheck PASS, lint 0 errors / 197 warnings, build PASS; those results are from the preceding fix, not a fresh run in this follow-up.

Only this report was updated for the follow-up. No new commit or push; no database/account/auth/curriculum/PDF/payment mutations, no CRUD actions, and unrelated WIP preserved. The existing loading fix commit 7fc22b2 was already pushed. Overview was left open for the owner.

Closure: all 19 Admin tab loading flows verified in the authenticated browser. No additional tab-loading blocker found. CRUD workflows, explicit desktop/mobile viewport QA, and exact per-request Network trace were not part of this follow-up verification and remain unverified; this is not a claim that every Admin capability is fully tested.
