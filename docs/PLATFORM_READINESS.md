# VYLO Platform Readiness

Generated from a code audit on branch `wip/renal-anatomy-practical`.
This document deliberately separates **missing code** from **missing content** and
**missing external configuration**. A subsystem is *programmatically complete*
when the software already knows how to handle the content the moment it arrives.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `COMPLETE` | Code complete: UI, server logic, authz, loading/empty/error states, tests. |
| `PARTIAL` | Works, but a known code gap remains. Listed with the exact next action. |
| `BLOCKED_CONTENT` | Code is ready; the source content simply does not exist yet. |
| `BLOCKED_EXTERNAL` | Code is ready; a credential, service approval or interactive install is missing. |
| `OWNER_DECISION` | Code is ready and deliberately disabled/awaiting a business decision. |
| `BLOCKED_GROUND_TRUTH` | Code is ready; a medical answer cannot be verified from any source. |

## CODE COMPLETE

- **Auth / sessions** — Better Auth, sign-in/up/out, forgot-password, verify-email routes; `getSession`/`requireUser`/`requireAdmin` helpers.
- **Access control** — `src/features/access/learning-access.ts` exposes a single server-side decision layer (`decideModuleAccess`, `getAccessibleLecture/Module/Question/OspeExam/Flashcard/ClinicalCase`, `isResourceOwner`). Buttons are not the enforcement point.
- **Curriculum** — modules/lectures by study year and term, per-term and all-term progress kept separate, hidden non-GPA modules (`mt-104`, `en-105`, `uni-205`) retained in DB/admin rather than deleted.
- **Lecture reader** — PDF delivery plus reader route.
- **Quiz** — bank, attempt, server-side grading, history, bookmarks, analytics.
- **Practical (student UX)** — `practical-practice.tsx` provides question number, stem, image, zoom in/out, radio options, submit, post-submit feedback only, bookmark, difficult flag, abort-safe loading, error and image-error states. The arrow overlay renders **only** when `targetX`/`targetY` exist, so recognition and diagnosis questions never receive an artificial arrow.
- **Practical (admin)** — authoring + content review components, review status, warnings.
- **OSPE** — exam/session/station schema, `ospeAnswerKey` deliberately kept distinct from live stations, `practical_track_ospe_station` as an explicit reviewed link, integrity tests, review pipeline.
- **Flashcards / SRS** — generation, due policy, review, per-user ownership, XP only when a card was due at review start.
- **Clinical cases** — generation, evaluation history, XP once-ever per case.
- **AI tutor** — lecture-scoped chat route, access-checked.
- **AI quota** — shared `study_generation` daily allowance with atomic reservation and idempotent generation; case evaluation does not consume generation quota.
- **Engagement / XP** — award sites with farming tests (`xp-farming`, `xp-atomic`, `case-xp-once-ever`).
- **Payments** — Paymob order/callback/webhook architecture with idempotent confirmation. **Deliberately disabled**; see OWNER_DECISION.
- **Promo / redeem** — code paths complete, redemption flag **off** by owner policy.
- **Admin Control Center** — overview, users, subscriptions, content health, curriculum, quiz, practical, OSPE, review, learning, AI, XP, activity, payments, promo, redeem, academic periods, audit, system.
- **Weekly study plan** — `src/features/planning/weeklyPlan.ts` is a pure, deterministic planner (no AI required) surfaced at `/api/planning/weekly` and rendered on the dashboard with loading / error+retry / truthful-empty states.

## NEW IN THIS SESSION

- **PDF-first practical extraction** — Poppler `pdftoppm` rasterization, pdfjs text geometry, raster row-occupancy whitespace segmentation, marker-aware student cropping, crop safety gates (answer-leak and next-question-contamination).
- **Printed-answer recovery** — answers are frequently unpunctuated ("Superior vena cava", "Ascending aorta", "Pulmonary artery ?"), so recovery takes the last prose line of a short-answer block instead of matching a trailing period.
- **Answer verification** — `answerVerification.ts` scores a printed answer against `ospe_answer_key` as `EXACT` / `STRONG` / `AMBIGUOUS` / `NONE`. Only `EXACT`/`STRONG` may auto-verify; anything else stays unresolved rather than guessed. Distractors are drawn exclusively from real key answers.
- **No auto-approval** — per owner instruction, every generated question is emitted as `NEEDS_REVIEW`. Verified items are *ready for review*, never approved.

## BLOCKED CONTENT (code is ready)

- **T4–T10 lecture content** — 0 lectures published for terms 4–10. Curriculum, progress, search, plan and access code already handle future terms; this is a content gap, not a code gap.
- **Pathology / histology / microbiology practical items** — the available `Patho.pdf` and `Micro.pdf` are lecture slides with no exam question blocks. The genuine practical sources are the two image-only Module 3 PDFs, which cannot yield stems without OCR.
- **300 approved practical questions per module** — a content-capacity target. The software measures and reports it (`reports/cvs-300-question-capacity.*`) and shows `SHORTFALL` rather than fabricating questions.

## BLOCKED EXTERNAL

- **OCR engine** — Tesseract is required to read the image-only Module 3 PDFs. Both `winget` candidates (`UB-Mannheim.TesseractOCR`, `tesseract-ocr.tesseract`) abort with `0x800704c7` because the installers require an interactive/elevated confirmation that cannot be automated. Owner command:
  `winget install --id UB-Mannheim.TesseractOCR --exact --accept-package-agreements --accept-source-agreements`
- **Paymob production account** — no live charging until credentials and business approval exist.
- **Email provider** — real sending is not exercised in tests.

## BLOCKED GROUND TRUTH

- **RESP correct answers** — all 51 `ospe_answer_key` rows with `folder='RESP'` have an **empty `diagnosis`**; the `identification` column stores the question prompt, not the answer. The RESP PDF prints no answer either. RESP source MCQs therefore have preserved 5-option sets but **no verifiable correct option**. This is reported as `SOURCE_GROUND_TRUTH_MISSING` and never guessed.
- **CVS `p8 Q12` ("Apex of the heart")** — the printed answer is recovered correctly but has no matching answer-key diagnosis, so it stays `NEEDS_REVIEW`.

## OWNER DECISION

- **Payments** — code production-ready, activation **OFF**.
- **Promo redemption** — code complete, `PROMO_REDEMPTION_ENABLED` stays **OFF**.
- **T10 numeric price** — depends on unverified GP-10 eligibility; no price is asserted.
- **GPA for e-1…e-4, gp-10** — deliberately preserved as `UNVERIFIED`.
- **Practical bulk import** — review-queue import is not performed; it needs explicit owner approval after a passing benchmark.

## Practical pilot status

10 real questions from 4 source PDFs (`OSPE CVS.pdf`, `OSPE RESP.pdf`, `Ospe module 3.pdf`).

- Source question 10/10, stem 10/10 (verbatim, never rewritten)
- Answer association 5/10 — blocked on RESP ground truth and one CVS mapping
- Answer leaks 0, next-question contamination 0, artificial arrows 0
- All 10 are `NEEDS_REVIEW` awaiting human approval

The 50-question benchmark gate has **not** been reached, so review-queue import is
not authorised.
