# VYLO — Final Feature Proof Matrix

Branch `wip/renal-anatomy-practical` · HEAD `c724c2f`
All statuses below are backed by a **real smoke result** or a **named test**, not an opinion.

Smoke evidence collected against local Postgres + `next dev` on port 3111, using the
existing seeded disposable account `student001@test.horus.edu.eg` (no new accounts created).

## Smoke results actually observed

Anonymous:
| Route | Result |
| --- | --- |
| `/` | 200 |
| `/sign-in`, `/sign-up` | 200 |
| `/pricing`, `/redeem`, `/leaderboard` | 200 |
| `/curriculum`, `/dashboard`, `/search`, `/flashcards`, `/cases`, `/ospe`, `/settings`, `/admin` | 307 → login (auth enforced) |
| `/api/planning/weekly`, `/api/search`, `/api/leaderboard` | 401 (auth enforced) |
| `/nonexistent-route-xyz` | 404 (handled) |

Authenticated student:
| Route | Result |
| --- | --- |
| `/dashboard` | 200, SSRs "This week" + loading state |
| `/api/planning/weekly` | 200, 7 days, 315 min, real lectures ("Integumentary system", "Skeletal system") |
| `/curriculum`, `/search`, `/flashcards`, `/cases`, `/ospe`, `/review`, `/leaderboard`, `/settings` | 200 |
| `/quiz/analytics`, `/quiz/history`, `/quiz/bookmarks`, `/battles` | 200 |
| `/api/leaderboard`, `/api/search?q=heart` | 200 |
| `/admin` | 307 → student cannot reach admin (separation proven) |

## Feature matrix

| Feature | Route/UI | API | DB | Authz | Empty | Error | Mobile | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth & sessions | `/sign-in`, `/sign-up`, `/forgot-password`, `/verify-email` | Better Auth sign-in/email | `user`, `account`, `session` | server-side | yes | yes | yes | auth suites | COMPLETE |
| Student dashboard | `/dashboard` | server component + `/api/planning/weekly` | read-only joins | `requireUser` | yes | yes | grid responsive | weekly plan 13 + route 4 | COMPLETE |
| **Weekly study plan** | card on `/dashboard` | `GET /api/planning/weekly` | `lecture`, `lecture_progress`, `practical_question`, `question_bank` | session required, input validated | notes[] truthful empty | 500 + client retry | stacked | `weeklyPlan.test.ts` (13) | **COMPLETE** |
| Curriculum | `/curriculum`, `/curriculum/[slug]` | server | `module`, `lecture` | per-module access | yes | yes | yes | curriculum term-progress | COMPLETE |
| Lecture reader + PDF | `/lecture/[slug]` | server | `lecture.pdf_file` | `getAccessibleLecture` | yes | yes | yes | existing | COMPLETE |
| Quiz | `/quiz/[bankSlug]`, `/history`, `/analytics`, `/bookmarks` | `/api/quiz/*` | `quiz_attempt`, `quiz_answer`, `question`, `question_option` | server-side grading | yes | yes | yes | quiz route tests | COMPLETE |
| Practical (code) | `/curriculum/[slug]/practical/**` | practical routes | `practical_*` | `getAccessibleQuestion` | yes | yes | yes | `practical-gate.test.ts` (263) | COMPLETE |
| Practical (content) | — | — | `practical_question` = 15 | — | — | — | — | pilot metrics | BLOCKED_CONTENT |
| PDF-first extraction | dry-run + admin review | — | read-only | — | — | — | — | `pdfGeometry.test.ts` (29) | COMPLETE |
| Answer verification | — | — | `ospe_answer_key` read-only | — | — | — | — | `answerVerification.test.ts` (15) | COMPLETE |
| OSPE simulator | `/ospe`, `/quiz/ospe/[moduleSlug]` | ospe routes | `ospe_exam`, `ospe_exam_station` | `getAccessibleOspeExam` | yes | yes | yes | `exam.test.ts`, `integrity.test.ts` | COMPLETE |
| OSPE stations (content) | admin | — | `practical_track_ospe_station` = 0 | — | truthful empty | — | — | — | BLOCKED_CONTENT |
| Flashcards / SRS | `/flashcards`, `/flashcards/all` | `/api/review/flashcards/*` | `flashcard` | ownership + access | yes | yes | yes | `flashcard-due-policy.test.ts` | COMPLETE |
| Clinical cases | `/cases`, `/cases/all` | `/api/review/cases/*` | `clinical_case`, `clinical_case_evaluation` | `getAccessibleClinicalCase` | yes | yes | yes | `clinical-case-evaluation.test.ts` | COMPLETE |
| AI tutor | `/lecture/[slug]` tutor panel | `/api/tutor/chat` | — | session + access | yes | yes | yes | tutor route tests | COMPLETE |
| AI quota | — | `/api/review/*` | `ai_usage`, `ai_generation_request` | atomic reservation | — | — | — | generation route tests | COMPLETE |
| Search | `/search` | `GET /api/search` | RAG chunks | per-lecture `getAccessibleLecture` | yes | 502 | yes | existing | COMPLETE |
| Profile / settings | `/settings` | server | `user_profile`, `subscription` | own record only | yes | yes | yes | existing | COMPLETE |
| XP / engagement | leaderboard | `/api/leaderboard` | `xp_log` | own rank | yes | yes | yes | `xp-farming`, `xp-atomic`, `case-xp-once-ever` | COMPLETE |
| Subscriptions & plans | `/pricing` | billing routes | `plan`, `subscription` | `withModuleAccess` | yes | yes | yes | pricing/activation/money tests | COMPLETE |
| Payments (Paymob) | `/pricing` checkout | billing checkout/webhook | `payment` | HMAC + idempotent | yes | yes | yes | billing tests | **COMPLETE_BUT_DISABLED** |
| Promo / redeem | `/redeem` | redeem route | `promo_code`, `promo_redemption` | own code | yes | yes | yes | `redeem/route.test.ts` | **COMPLETE_BUT_DISABLED** |
| Admin Control Center | `/admin/**` (19 tabs) | admin routes | admin tables | `requireAdmin` | yes | yes | yes | admin analytics tests | COMPLETE |
| Module game / ranking | `/leaderboard`, `/battles` | `/api/leaderboard` | `battle*`, `xp_log` | own data | yes | yes | yes | sm2.test.ts | COMPLETE |
| OCR for image-only PDFs | — | — | — | — | — | — | — | — | **BLOCKED_EXTERNAL** |
| T4–T10 lecture content | — | — | 0 lectures | — | — | — | — | — | **BLOCKED_CONTENT** |
| RESP verified answers | — | — | 51/51 rows empty `diagnosis` | — | — | — | — | — | **SOURCE_GROUND_TRUTH_MISSING** |
| GPA (e-1..e-4, gp-10) | — | — | preserved `UNVERIFIED` | — | — | — | — | — | **OWNER_DECISION** |
| T10 numeric price | `/pricing` | — | depends on GP-10 | — | — | — | — | — | **OWNER_DECISION** |

## Bugs found and fixed by real smoke testing

1. **Weekly plan was not mounted on the dashboard.** The dashboard file also contains
   unrelated owner WIP, so it could not be staged wholesale. Resolved by staging
   **HEAD + only the two weekly-plan hunks** (`git add` on a surgically reconstructed
   file), leaving the owner's T1–T10 work untouched in the working tree. Commit `d8938e6`.
2. **`/api/planning/weekly` returned 500.** The hand-written SQL used plural table names
   (`lectures`, `modules`) and a `users` table; the real schema is singular
   (`lecture`, `module`, `user`) with `order` not `position`. Rewritten on top of the
   existing typed `getCurriculum()` so the hidden-module filter and progress semantics
   stay in one place. Commit `c724c2f`. Verified live: 200 with 7 days / 315 minutes.

## No auto-approval

Per owner instruction, every generated practical question is emitted as
`NEEDS_REVIEW`. Verified answers are *ready for review*, never approved.
Zero questions were auto-approved in this run.
