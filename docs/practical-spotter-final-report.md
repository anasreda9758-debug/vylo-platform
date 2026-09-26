# Practical Spotter — Pre-Live Hardening & Authoring MVP — Final Report

Date: 2026-09-27 · Branch: `wip/renal-anatomy-practical` · Status: **code + schema complete; migrations 0023/0024/0025 APPLIED to live lms on 2026-09-27 (owner-authorized, preflight + recovery verified)**

All gate results are after the last change (schema/0025 FK fix).

## 1. Quality Gate (final)

| Gate        | Result                                                       |
|-------------|--------------------------------------------------------------|
| Vitest      | **269 passing** / 34 files (baseline was 233 before this task) |
| TypeScript  | `tsc --noEmit` **0 errors**                                   |
| ESLint      | **0 errors**, 178 pre-existing warnings                      |

New test suites added this task: practical generate route (13), authoring helpers (17), practical gate/security (10), plus updated flashcards route idempotency (incl. cross-user + 409 conflict) and ai-quota case-evaluation regression.

## 2. Live `lms` — LIVE MIGRATION COMPLETED (2026-09-27)

- Migrations **0023 → 0024 → 0025 applied to live `lms`** (owner-authorized), in order, each inside its own transaction with a Drizzle-format ledger record (sha256 of the file, matching the existing ledger's hash algorithm — verified on all 24 pre-existing rows):
  - Ledger id 25 = `0023_clinical_case_evaluation_xp_protection.sql` (sha256 `885c96fd…`)
  - Ledger id 26 = `0024_ai_quota_idempotency.sql` (sha256 `5f6cdaba…`)
  - Ledger id 27 = `0025_practical_spotter_authoring.sql` (sha256 `eaa55ef9…`)
- Why not `drizzle-kit migrate`: `drizzle/meta/_journal.json` has no entries for 0023/24/25 (and lists the unrelated 0021/0022), so the journal-driven path cannot apply them; full SQL files were executed verbatim (never hand-edited), and the ledger was maintained with drizzle-kit's own hash format. No journal edits were made (avoids polluting another task's WIP).
- Preflight: PG 18.4, datadir `C:/work/projects/platform/.pgdata`, port 5432; `clinical_case_evaluation`/`ai_usage_daily`/`ai_generation_request` absent; no 0025 columns; `case_complete` duplicates = 0 (total rows 1, NULL refs 0) → unique index safe.
- Recovery points (created before apply):
  - `vylo_prelive_backup_20260927` — full consistent copy via `CREATE DATABASE … TEMPLATE lms`; parity PASS on all 19 app tables + ledger (24 rows); 25,417,407 bytes; timestamp 2026-09-26T21:37Z. Kept.
  - `vylo-prelive-logical-backup-20260927.sql` (OS temp) — logical INSERT dump, 668 rows / 19 tables, 2,227,823 bytes; **restore VERIFIED** by replaying into a scratch DB and matching all counts; scratch DB dropped.
- Post-apply verification: every 0023/0024/0025 object confirmed (see sections 4–6); **`generation_request_id` is `uuid` and matches `ai_generation_request(id uuid)`** (FK `ON DELETE SET NULL`); schema smoke tests passed inside a rolled-back transaction (no QA rows left: evals 0, requests 0, usage 0, practical_image back to 1).
- Final data state: all 19 application-table counts identical to preflight baseline; `payment` = 0; new tables empty.
- Read-only inventory: `practical_image` = 1 (labeled; markers>0; DRAFT_AI; subject Anatomy); `practical_question` = 10 (all LABELED_STRUCTURE, DRAFT_AI, all have image).
- Pre-existing note: a legacy ledger row (id 24) matches no current file in `drizzle/` — predates this task; left untouched.

## 3. Migration Ledger reality check (Phase 18) — correction

- A real ledger **exists**: `drizzle.__drizzle_migrations` (+ its `id` sequence) is present in `schema drizzle` on `lms` and every clone (`vylo_entitlement_qa_20260921`, `vylo_rehearsal_20260921a`, `vylo_xp_audit_clone`).
- Earlier "no ledger anywhere" audit was wrong because it looked at the wrong/other schema. `postgres` template DB has none.
- Finding: Drizzle journaling runs in its own `drizzle` schema; future audits must query both `public` and `drizzle`.

## 4. Clone rehearsal (Phase 17) — 0023 → 0024 → 0025

- Fresh clone `vylo_rehearsal_20260926b` taken from live `lms` via `CREATE DATABASE … TEMPLATE lms` = genuine **pre-0023/24 state** (BEFORE snapshot: practical_image 12 cols, practical_question 24 cols — matches live).
- Applied in order **0023 → 0024 → 0025** — clean.
- **Idempotent re-run**: repeated application is safe (all `IF NOT EXISTS`/skips; NOTICE-only). AFTER snapshots identical.
- Verified artifacts after chain:
  - `ai_generation_request`: `UNIQUE (user_id, idempotency_key)`, `status` CHECK (pending/completed/failed/duplicate), feature CHECK, `(user_id, feature, lecture_id, practical_track_id)` index, `id uuid PK DEFAULT gen_random_uuid()`.
  - `ai_usage_daily`: `usage_date DATE NOT NULL` + `(user_id, usage_date, bucket)` unique behavior (existing `ai_usage_daily_user_date_idx`).
  - `clinical_case_evaluation`: `UNIQUE (case_id, user_id, attempt_number)` + `xp_log_user_case_complete_unique` (partial, `case_complete`).
  - 0025 columns on `practical_image` and `practical_question`: `source_image_id`, `exam_image_id`, `target_x/target_y` with `CHECK (target BETWEEN 0 AND 1)`, `correct_structure`, `generation_request_id` FK on delete set null, `generation_status`, `review_status`, `generated_by_ai`, `is_exam_derivative`.
- **Bug caught & fixed by rehearsal**: 0025 declared `generation_request_id TEXT` referencing `ai_generation_request(id UUID)` → PG rejected FK (`text vs uuid`). Fixed 0025 to `UUID` and ORM `practicalQuestion.generationRequestId` to `uuid("generation_request_id")`.

## 5. Practical Generate pipeline (code complete, tests passing)

- **Eligibility (forced DRAFT)**: question + image must both be `APPROVED`; authoring-verified rows bypass legacy sha256 approval; labeled `source_image_id` images never served. DRAFT/NEEDS_REVIEW/REJECTED never visible. All markers present.
- **AI authoring**: if no verified (`APPROVED` + `is_exam_derivative:true` + storageKey) clean-exam image exists for the same source image → call AI once with distractors-only system prompt → missing answer ⇒ `NEEDS_REVIEW` pending (no 400); else create verified row.
- **Five options**: exactly 5 normalized, unique, non-blank options; `opt_0` = verified answer; invalid ⇒ `NEEDS_REVIEW` (never AI-verified).
- **Target**: `target_x/target_y` 0..1 validated + clamped at render; local normalized `MarkerTarget`; `targetPosition` clamps and maps px across widths (320–1440).
- **Idempotency (user-scoped)**: same key ⇒ `duplicate:true`, nothing regenerated, one reserve; same key + different lecture ⇒ 409; key reuse skips quota re-charge; cross-user keys independent.
- **Quota-on-success**: free daily bucket `STUDY_GENERATION` (15) charged only when AI succeeds; failed AI consumes nothing; limit ⇒ 503.
- **Student payload security**: allowlist drops `correctOptionId`, `explanation`, `identifyingClue`, `commonMistake`, `examTip`, `sourceMaterial`, `sourcePage`, `correctStructure`, `reviewStatus`, `sourceImageId`, `examImageId`. Correctness verified only server-side via `gradeChoice` mocking dp.

## 6. Admin authoring (cleaning MVP — Phase 5/6 verdict)

**Verdict: CLEANING MVP = delivered (admin-verified clean-exam path). Marker-mask tool = NOT in this scope; covered by the AI `markers-only` labeling prompt and admin `reject` on a mislabeled row.**

- `PATCH /api/admin/practical-authoring`: `update-target`, `set-structure`, `set-correct-option`, `update-options`, `link-exam`, `approve-image`/`reject-image`, `approve-question`/`reject-question`, `upload-clean` (base64; png/jpg/jpeg/webp; ≤8MB; written to `private/practical-images/admin-clean-<uuid>.<ext>`, row created DRAFT review). `GET` catalog + `?preview=` student-owned payload for QA. All gated by `requireAdmin`.
- `/admin/practical` page + `practical-authoring-admin.tsx` client (image grid, original/clean panels, question panels, live preview).

## 7. What was NOT done / deferred

- 0021–0025 NOT applied to live (owner-drill rule: clone-only).
- Marker-eraser/canvas-masking UI for exam-image cleanup (future task; AI prompt + admin reject covers the loop today).
- 12 unrelated pre-existing lint warnings (paymob/proxy/cache) left untouched.

## 8. Files changed/added (this task)

- `drizzle/0023_clinical_case_evaluation_xp_protection.sql` (verified as-is on clone)
- `drizzle/0024_ai_quota_idempotency.sql` (rewritten: DATE + user-scoped idempotency)
- `drizzle/0025_practical_spotter_authoring.sql` (new; **FK uuid fix applied**)
- `src/features/practical/schema.ts` (uuid generationRequestId)
- `src/features/practical/model.ts` (reviewStatusSchema, authoringVerified eligibility)
- `src/features/practical/authoring.ts` + `authoring.test.ts` (17)
- `src/features/practical/practical-gate.test.ts` (10)
- `src/features/practical/http.ts` (correctStructure optional)
- `src/features/gamification/schema.ts`, `idempotency.ts`
- `src/app/api/practical/generate/route.ts` + `route.test.ts` (13)
- `src/app/api/admin/practical-authoring/route.ts`, `src/app/admin/practical/page.tsx`, `src/components/practical-authoring-admin.tsx`
- `src/app/api/review/flashcards/route.test.ts`, `src/app/api/review/{flashcards,cases}/route.ts` (phase 3/3B)
- `src/features/review/clinical-case-evaluation.test.ts` (sync tx.insert), `src/features/ai/ai-quota.test.ts`

**Deploy note:** 0023→0024→0025 were applied to live `lms` on 2026-09-27 (ledger ids 25–27). The chain is idempotent (all `IF NOT EXISTS`), and re-application is a no-op. Bulk practical image conversion has NOT started — still pending the owner's explicit go-ahead.

---

# Appendix — FIRST REAL PILOT (owner-supplied OSPE RENAL images, 2026-09-27)

Repository state: branch `wip/renal-anatomy-practical` (HEAD `646e2ea`), dev server on :3000. Codebase unchanged in this appendix — **data authoring only** (real image copies into `private/practical-images` + 10 `practical_image` rows + 5 `practical_question` rows). No migration, no AI quota consumed (`ai_usage_daily`=0, `ai_generation_request`=0 after).

## 1. Source images (the owner's real assets at `C:\work\projects\images\RENAL`)

All five candidates are real OSPE RENAL exam cards already referenced by live `ospe_answer_key` rows (folder=RENAL, diagnosis+identification verified, 24 distinct diagnoses, 0 unmatched/duplicates across the folder's 243 files). Each pilot image = one distinct verified structure = one question (scope per owner decision).

| Source file (real, unmodified) | Size | sha256 (recorded in source_material) | Verified diagnosis (ospe_answer_key) | identification |
|---|---|---|---|---|
| `OSPE RENAL-105.png` | 620,721 | `7cb3f7e7…bc37` | Kidney | Bean-shaped organ producing urine |
| `OSPE RENAL-134.jpg` | 345,327 | `c1839555…cbb` | Ureter | Muscular tube carrying urine from kidney to bladder |
| `OSPE RENAL-4.png` | 1,019,394 | `1f1f6401…0aae` | Renal artery | Branch of abdominal aorta supplying kidney |
| `OSPE RENAL-373.png` | 505,644 | `8b2c3ae6…7c7c` | Renal vein | Vein draining kidney into inferior vena cava |
| `OSPE RENAL-244.png` | 441,797 | `bb3448ee…49f9` | Adrenal gland | Endocrine gland on superior pole of kidney |

- Module: `rau-203` (`ada77ba1-458a-45a7-81d3-4a2047bde027` "Renal & Urinary System (RAU-203)"); subject `Anatomy`, study year 1, track `practical-track-rau-203-anatomy` (PUBLISHED, practice_enabled=true, ospe_enabled=false).
- Originals at `C:\work\projects\images\RENAL` left byte-for-byte untouched. Copies placed in `private/practical-images/` with deterministic keys (`<slug>-source.<ext>`, `<slug>-exam.<ext>`); both copies are byte-identical to the real card (sha256 identical), served only via `readPracticalImage` (path-traversal guarded, png/jpeg allowed).
- Clean method: the OSPE cards are already exam-style images (arrow embedded in the original card); no AI generation, no masking, no invented labels — the student-visible "clean" image is the real card, and the verified structure comes from the DB answer key. `is_exam_derivative=true`, `generated_by_ai=false`.

## 2. What was created (all BEFORE→AFTER verified)

- `practical_image`: 1 → **11** (fixture untouched + 5 sources + 5 exam derivatives).
- `practical_question`: 10 → **15** (all 10 fixtures untouched + 5 real, one per image).
- New rows (all DRAFT status, reviewStatus DRAFT/NEEDS_REVIEW — **nothing APPROVED, nothing student-visible**):
  - source images: `renal-105-kidney-source-img-v1`, `renal-134-ureter-source-img-v1`, `renal-4-renal-artery-source-img-v1`, `renal-373-renal-vein-source-img-v1`, `renal-244-adrenal-gland-source-img-v1`
  - exam images: `*-exam-img-v1` (same ids, `examImageId` group) — reviewStatus `NEEDS_REVIEW`
  - questions: `renal-105-kidney-q-v1`, `renal-134-ureter-q-v1`, `renal-4-renal-artery-q-v1`, `renal-373-renal-vein-q-v1`, `renal-244-adrenal-gland-q-v1` — `IMAGE_IDENTIFICATION`, target `*` prompt "Identify the structure indicated by the arrow.", group `pilot-renal-ospe-v1`, order 0–4.
- `practical_progress` 1 / `practical_submission` 2 (pre-existing fixture exercise from 2026-09-12/13, untouched); no new usage/submissions.

## 3. Options integrity (exactly 5 per question, correct always `opt_0`)

Correct = the verified `ospe_answer_key` diagnosis. Distractors = other verified RENAL structures from the same answer-key folder (no AI, no invented anatomy):

| Question | opt_0 (correct) | opt_1 | opt_2 | opt_3 | opt_4 |
|---|---|---|---|---|---|
| renal-105-kidney | Kidney | Renal fascia | Perinephric fat | Adrenal gland | Ureter |
| renal-134-ureter | Ureter | Kidney | Renal vein | Psoas major | Renal artery |
| renal-4-renal-artery | Renal artery | Renal vein | Kidney | Adrenal gland | Ureter |
| renal-373-renal-vein | Renal vein | Renal artery | Inferior vena cava | Kidney | Ureter |
| renal-244-adrenal-gland | Adrenal gland | Kidney | Renal fascia | Perinephric fat | Psoas major |

All 5 rows passed `questionSchema` (unique ids, unique option ids, exactly one valid `correctOptionId` matching `options @> …`) and the DB check `practical_correct_option`. `buildFiveOptions` semantics honoured (correct at opt_0). Teaching aids (explanation/identifyingClue) reuse the answer-key identification text verbatim; commonMistake/examTip are generic exam guidance (no fabricated anatomy).

## 4. Arrow / target coordinates per question

- The source OSPE cards embed their own arrow (exam card format); `target_x/target_y` are intentionally **NULL (not invented)** on all 5 questions and images. The agent has no vision capability and refuses to fabricate coordinates; arrow placement is verified by the owner at admin review (`update-target`, 0..1, persisted + clamped, `targetPosition` math already unit-tested at 320/390/768/1024/1440px).
- Admin per-question review gates apply: `approve-image` (source + exam derivative) → `set-structure` (already set from answer key) → `update-target`, `update-options` (already 5) → `approve-question`. `eligibleQuestion` returns false for all 5 today (status APPROVED + `authoringVerified`/sha256-approved source both unsatisfied) — verified by running the app's own `getAuthoringCatalog` + `readPracticalImage` + `eligibleQuestion`.

## 5. Integrity bugs discovered during the pilot (unchanged code, reported only)

1. **`trackId` never set on exam derivatives by the authoring routes.** `practicalStore.catalog` inner-joins `practicalQuestion.trackId = scope.trackId` **and** `practicalImage.trackId = scope.trackId` (`store.ts:12-17`), and `generate/route.ts:163` + `upload-clean` (`admin route:151`) insert derivative images **without** `practical_track_id`. Consequence: an approved real question whose exam image went through either route could never appear for students (image.trackId NULL never equals the scope track). The 5 pilot rows avoid this by setting `practical_track_id` explicitly on the source AND exam image rows; the routes still need the fix (assign `sourceImage.trackId`) before bulk authoring.
2. English-only authoring is enforced in Zod schema but the DB `source_material`/`options` columns have no CHECK constraint — acceptable (all app writes go through Zod), noted for defense-in-depth only.

## 6. Gates (data-only change, code untouched — all re-run 2026-09-27)

- Vitest **269 passing / 34 files** (baseline maintained).
- `tsc --noEmit` **0 errors**.
- ESLint **0 errors** (178 pre-existing warnings, unrelated, untouched).

## 7. Commit / push

- `.gitignore`: added `/private/` (keeps the new real-image copies out of git; images are runtime-only assets under `private/practical-images/`).
- Focused commit **only**: `.gitignore` + this report appendix. No `git add ./-A`; unrelated WIP (semester-3 scripts, billing, curriculum, recovery assets, etc.) untouched.
- Branch `wip/renal-anatomy-practical`, push to `origin`.

## 8. Verdict

**PILOT DELIVERED — READY FOR ADMIN REVIEW — NOT READY FOR BULK UNTIL:**
1. Owner approves the 5 questions (or rejects/adjusts) in `/admin/practical`; acceptable = `#APPROVED ≥ 3`.
2. Owner confirms arrow targets for each approved question (`update-target`).
3. The `trackId`-on-derivative bug (section 5.1) is fixed in `generate` and `upload-clean` routes so bulk authoring can surface approved rows.
4. Distractor/teaching-language sweep of any future bulk content (must stay English-only, no fabricated anatomy).

Once those hold, the same verified-source flow scales to the remaining 238 answer-keyed RENAL files and the CVS/IBL/RESP libraries.