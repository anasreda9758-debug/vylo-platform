# VYLO external tester blockers remediation

2026-10-03 05:53 Africa/Cairo. Branch: `wip/renal-anatomy-practical`.
**Final limited-invite verdict: C. NOT READY.** Code/configuration blockers addressed below; actual isolated HTTPS staging is not deployed, and legitimate Student/Admin browser QA is still owner work. Disabled payments are intentional and are NOT the reason for this verdict.

## Requested final report

| # | Item | Result |
|---|---|---|
| 1 | Starting HEAD | `13e68fd01115f90bf4f754fb3bc4d2d4618f7585` |
| 2 | Exact vulnerability | SEC-005: owner-only saved flashcard/case lists could return protected lecture-derived text after entitlement/release access was lost. The untracked library pages reuse these shared lists. |
| 3 | Affected features | Due/all flashcards; recent/all clinical cases; unused case-detail helper hardened. Battle history also now filters inaccessible source banks. |
| 4 | Root cause | Owner ownership was enforced, but current curriculum authorization was not rechecked on collection reads. This was not a demonstrated cross-user exploit in existing guarded card/case APIs. |
| 5 | Ownership implementation | Lists bind their owner argument to the real server session; candidate queries select lecture IDs only. Full-content SQL is constrained by both owner and centrally authorized lecture IDs, before React serialization. Private Admin records obey the same owner boundary. |
| 6 | IDOR read | PASS: owner allowed; B/anonymous denied; Admin cannot read someone else's private case/card/attempt/exam. Generic not-found results do not expose existence. |
| 7 | IDOR update | PASS: actual card-review/case-evaluation/quiz-finish/OSPE-answer routes retain trusted actor IDs and reject B before writes; forged ownership fields ignored. Practical owner/track tests retained. |
| 8 | IDOR delete | PASS: existing notes DELETE is owner-scoped SQL; B receives indistinguishable success/no-op without deleting A's note; anonymous denied. No card/case/Tutor delete endpoints exist to invent. |
| 9 | Cross-user lists | PASS: collection owner cannot be selected through the helper argument; anonymous/B cannot retrieve A's lists; battle participant relationship plus bank authorization preserved. |
| 10 | Hidden saved content | PASS: Years 3–5 and unmapped Year 2 denied before full derivative content query; Admin's own hidden-year access retained. |
| 11 | Future stored content | PASS: future academic period/inactive Summer denied; current period positives pass using full authoritative period fixtures. |
| 12 | Paid stored context | PASS: lost subscription denies stored derivatives. Saved content does not acquire a new first-lecture preview entitlement. Records/schedules/history remain in DB unchanged. |
| 13 | Existing deployment | VPS/Docker/standalone Next/PostgreSQL configuration exists; no actual external deployment, CDN or reverse proxy was established. Docker/Caddy executables unavailable locally. |
| 14 | HTTPS staging | Same stack plus Caddy TLS edge; production runner, exact separate HTTPS origin, private DB network, read-only content, manual-only deployment, no automatic seed/migration. See STAGING_ACCESS.md. |
| 15 | Secure cookies | Existing production Better Auth: Secure, HttpOnly, SameSite=Lax. Exact staging origin enforced and trusted origin constrained. Code/config/tests verified; real HTTPS browser flags NOT VERIFIED. |
| 16 | HTTP redirect | Caddy automatic HTTPS prepares HTTP→HTTPS; fixed forwarded HTTPS/host. Actual certificate/DNS/redirect NOT VERIFIED until owner deploys. |
| 17 | Public DB exposure | NO in prepared Compose: no db/app published ports; db network internal. No remote firewall/socket test possible before deployment. Local services not externally published by this task. |
| 18 | Payments accidentally enabled | NO: no Paymob variables forwarded; validator rejects configured Paymob secrets. Checkout fails closed without provider configuration; no production webhook/keys added. Dormant payment remediation remains separate. |
| 19 | PDF regression | PASS deterministic authorization/storage tests and anonymous live HTTP: 401/private,no-store on repeated PDF GET; known legacy/public/encoded/study-card paths 404. Real entitled browser PDF/edge verification still owner action. |
| 20 | Tutor regression | PASS source filtering/entry authorization/input-limit/forged identity tests. Live anonymous route 401. No real hosted provider call. |
| 21 | AI quota | PASS: shared atomic finite 15/day, including subscriber and Admin; reservation before hosted cost, fail-closed DB errors. No real counter writes. Not a global monetary/RPM guarantee. |
| 22 | Student authenticated QA | OWNER ACTION REQUIRED / NOT VERIFIED: CUA inventory had no tabs or authenticated sessions. No credentials requested, login bypass or account change. |
| 23 | Admin authenticated QA | OWNER ACTION REQUIRED / NOT VERIFIED, same limitation. Not a platform FAIL. |
| 24 | Manual checklist | YES: AUTHENTICATED_QA_CHECKLIST.md, exact Student/Admin expected results at desktop/mobile. |
| 25 | Modules before/after | 44 / 44 |
| 26 | Lectures before/after | 394 / 394 |
| 27 | Questions before/after | 740 / 740 |
| 28 | Tests added | 163: saved-content 65, persisted-route 67, staging 29, create mass-assignment 2. |
| 29 | Total tests | PASS: 1199 tests / 84 files in the current working tree, including preserved unrelated WIP tests. Do not equate this with an already observed remote CI run. |
| 30 | Focused security tests | PASS: 314 / 16 files, covering previous P0 paths, new persisted/staging tests and Practical pilot/track/OSPE scope. |
| 31 | Typecheck | PASS: npm run typecheck, after production build. |
| 32 | Lint | PASS: 0 errors, 197 existing warnings; no unrelated warning cleanup. |
| 33 | Build | PASS: npm run build. Nine existing broad-filesystem-tracing warnings remain. Docker image build/artifact and real Caddy validation NOT VERIFIED locally. |
| 34 | Files changed | Exact 19 task files listed below; no user WIP pages/curriculum query files staged. |
| 35 | Schema changes | NO |
| 36 | Data changes | NO DB records, PDFs, curriculum/mappings, pricing, accounts, roles, approvals, payment credentials or sessions changed. |
| 37 | WIP preserved | YES: SHA-256 verification of all 26 pre-existing tracked WIP files unchanged; unrelated untracked files retained and excluded from commit. |
| 38 | Commit | Task commit is produced after this report; exact SHA is in final handoff and git log -1 (embedding its own SHA here would be self-referential). Message: fix: secure persisted content and staging access. |
| 39 | Push | Normal current-branch push performed after all gates/review; exact outcome in final handoff. No automatic merge. |
| 40 | Invited tester blocker | OWNER ACTION: provision/review isolated populated staging DB/content/accounts, build/check actual Docker artifact, DNS/TLS/private ports/cookies, deploy reviewed commit, then legitimate Student/Admin desktop/mobile QA and safe cross-user checks. No guessed configuration or public dev exposure. |
| 41 | Real payment blocker | Separate owner-approved fail-closed HMAC, trusted amount/currency/order/status, atomic entitlement/idempotency/replay reconciliation; production credentials/provider setup and verification. Payments remain OFF, outside invited-test readiness. |
| 42 | Public launch blocker | Remaining audit findings: legacy unreviewed OSPE, CSV/error/auth-recovery rate controls, dependency review, production DB least privilege, real TLS/artifact/cache/recovery/isolation QA, staging fixture policy and broader AI monetary limits. This is not a 100% security claim. |

## Persisted-feature inventory and server enforcement evidence

| Actual feature | Read/list/detail | Create/update/delete and trusted authority |
|---|---|---|
| Flashcards (flashcard) | review/queries.ts lists now session-owner + current lecture checks; learning-access.ts getAccessibleFlashcard protects details | api/review/flashcards and review route: real session + source/record authorization; explicit fields, SQL owner WHERE on rating update. No delete/regeneration/export endpoint. |
| Cases/evaluations (clinical_case, clinical_case_evaluation) | shared case lists hardened; case helper uses getAccessibleClinicalCase | creation/evaluation API guards owner and lecture before provider/evaluation save; server actor fields, advisory-lock attempt numbering unchanged. No user delete API. |
| Tutor messages | tutor-chat.tsx keeps React state; no saved conversation table or reload route | api/tutor/chat authorizes entry and every retrieved context before prompt/source headers. ai_usage stores usage metadata, not a saved transcript. |
| AI request replay | gamification/idempotency.ts binds user + key + feature/source conflict | create/generate routes authorize curriculum before resume/replay and derive user from session; never trust client owner. |
| Quiz attempts/answers/history | central getAccessibleQuizAttempt owner + bank; history/analytics filters authorized module | quiz answer/finish check attempt owner, bank/question/option relationship; explicit server fields. No user attempt delete. |
| Bookmarks and spaced review | owner-filtered queries then central question/review access before serialization | bookmark/review APIs derive session owner and validate current source; owner-scoped existing toggle/delete. No role assignment. |
| Notes (lecture_note) | api/lecture-notes GET scopes session owner and centrally authorized lecture | POST selects explicit trusted fields; DELETE matches note ID AND user ID and remains privacy cleanup even when source unavailable. No update API. |
| Progress | own lecture progress used with currently visible curriculum | curriculum/toggle requires source access + owner SQL insert/delete; client module slug is not authority. |
| Weekly plan | computed from authorized current curriculum and own progress; no persisted plan schema | planning/weekly reads authenticated actor, no plan CRUD added. |
| Practical | service resolves authoritative module/subject, catalog eligibility, owner progress | answer/flag stores actor.id after scoped question resolution; commits before feedback. Production fixtures disabled and unapproved questions excluded. pilot/track-binding/ospe-scope tests retained. |
| OSPE exams/answers | getAccessibleOspeExam checks owner/current module-track or legacy folder scope; studentExam strips unfinished grading | exam create/answer/finish routes use session actor; exam functions validate station membership. Existing legacy approval finding remains, not solved by changing station data or enabling OSPE. |
| Summary/mindmap/generated source questions | shared curriculum, not private student objects; protected lecture/bank routes authorize source | no new student authoring/ownership feature; unchanged curriculum. |
| Battles/challenges | participant-scoped state is intentional multiplayer authority; history now current bank-authorized | battle APIs require participant/source checks; server controls identity, options, score. No cross-user list fallback. |
| XP/streak/profile | authenticated private calculations; public leaderboard is its existing intentionally public name/XP DTO | server actor and reward-source checks, no client role/subscription mass assignment. |
| Admin authoring | existing requireAdminApi protects management paths | private student ownership is not waived merely by role; explicit Admin curriculum bypass retained. No new admin permissions. |

Functions used for policy: learning-access.ts current getAccessibleLecture/canAccessModule/getAccessibleQuestionBankBySlug/getAccessibleClinicalCase/getAccessibleQuizAttempt/getAccessibleOspeExam and academic-visibility-server policy. The new persisted-content.ts does not implement a parallel curriculum policy.

## Integrity verification

SELECT-only before/after queries; no scripts that seed/import/reset/migrate were executed.
Module fingerprint: fc8b63113c525326f6e92b02d309e3be.
Lecture fingerprint: 5fc7d6b1fa1963d086251c501ccf46b1.
Academic-period fingerprint: e29b20ab8e8a68fb9df2f5ba28f983f8.
All unchanged. OSPE answer keys 759 / associations 0 unchanged. Practical tracks 1, images 11, questions 15, all DRAFT_AI (10 fixtures / 5 nonfixtures); APPROVED 0. No mappings/approvals enabled.

Year 1: 10 modules / 248 lectures / 10 mapped.
Year 2: 8 modules / 146 lectures / 0 mapped.
Years 3–5: 26 modules total, no lectures or period mappings; Admin management visibility retained in policy tests.
No guessed dates or new period rows.

## Exact task files

1. .dockerignore
2. .env.staging.example
3. .github/workflows/deploy-staging.yml
4. .gitignore
5. Dockerfile
6. docker-compose.staging.yml
7. deploy/staging/Caddyfile
8. scripts/validate-staging-env.mjs
9. src/features/access/persisted-content.ts
10. src/features/review/queries.ts
11. src/features/gamification/battles.ts
12. src/features/review/persisted-content.test.ts
13. src/features/access/persisted-routes.test.ts
14. src/shared/staging-security.test.ts
15. src/app/api/review/flashcards/route.test.ts
16. src/app/api/review/cases/route.test.ts
17. STAGING_ACCESS.md
18. AUTHENTICATED_QA_CHECKLIST.md
19. EXTERNAL_TESTER_BLOCKERS_REMEDIATION.md

## Scope and next owner action

No deployment occurred; no external shared cache exists to purge. Existing local services were not stopped. Actual TLS/cookie/reverse-proxy/static-storage/runtime isolation cannot be certified by mocks or component existence. See STAGING_ACCESS.md first, then AUTHENTICATED_QA_CHECKLIST.md. Do not invite external testers until those owner operations are completed; do not activate payments or unreviewed OSPE as part of them.
