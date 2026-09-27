# VYLO Platform Readiness Matrix

Branch `wip/renal-anatomy-practical`. See `docs/PLATFORM_READINESS.md` for the narrative.

Status meanings: `COMPLETE` (code done) · `PARTIAL` (known code gap) · `BLOCKED_CONTENT` ·
`BLOCKED_EXTERNAL` · `OWNER_DECISION` · `BLOCKED_GROUND_TRUTH`.

| Area | Status | Known limitation | Next action |
| --- | --- | --- | --- |
| Authentication & sessions | COMPLETE | — | — |
| Access control (server-side) | COMPLETE | — | — |
| Curriculum & progress | COMPLETE | T4–T10 have 0 lectures (content) | publish content when supplied |
| Lecture reader + PDF delivery | COMPLETE | — | — |
| Quiz (bank, grading, history, analytics) | COMPLETE | — | — |
| Practical student UX | COMPLETE | — | — |
| Practical PDF-first extraction | COMPLETE | needs Poppler on PATH/WinGet | — |
| Practical answer verification | COMPLETE | RESP key stores prompts, not answers | — |
| Practical pathology/histology/micro | BLOCKED_EXTERNAL | sources are lecture slides or image-only | install OCR, then extract |
| OSPE simulator | COMPLETE | — | — |
| Flashcards / SRS | COMPLETE | — | — |
| Clinical cases | COMPLETE | — | — |
| AI tutor | COMPLETE | — | — |
| AI quota & idempotency | COMPLETE | — | — |
| **Weekly study plan** | COMPLETE | — | — |
| Search & navigation | COMPLETE | — | — |
| XP / engagement | COMPLETE | — | — |
| Admin Control Center | COMPLETE | — | — |
| Payments (Paymob) | OWNER_DECISION | activation deliberately OFF | owner approval + credentials |
| Promo redemption | OWNER_DECISION | redemption flag OFF | owner policy decision |
| Subscriptions & plans | COMPLETE | T10 price needs GP-10 status | confirm GP-10 |
| OCR for image-only PDFs | BLOCKED_EXTERNAL | Tesseract installers abort 0x800704c7 | owner runs winget install |
| RESP verified answers | BLOCKED_GROUND_TRUTH | 51/51 key rows have empty diagnosis | supply a real answer key |
| 300 approved questions/module | BLOCKED_CONTENT | capacity reports SHORTFALL | supply more labelled sources |
| T4–T10 lecture content | BLOCKED_CONTENT | 0 lectures published | owner supplies PDFs |
| GPA (e-1..e-4, gp-10) | OWNER_DECISION | preserved UNVERIFIED | owner supplies GPA |

## Feature-not-implemented

**None remaining in the audited scope.** The gaps above are content, external
dependency, ground truth, or deliberate owner decisions.

## Practical pilot metrics

| Metric | Value |
| --- | --- |
| Questions | 10 (real PDFs) |
| Source question correct | 10/10 |
| Stem correct | 10/10 |
| Answer association | 5/10 |
| Answer leaks | 0 |
| Next-question contamination | 0 |
| Artificial arrows | 0 |
| Auto-approved | 0 (owner policy: everything needs human approval) |
| 50-question benchmark | not reached |
| Review-queue import | not authorised |
