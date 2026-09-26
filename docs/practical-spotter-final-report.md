# Practical Spotter — Pre-Live Hardening & Authoring MVP — Final Report

Date: 2026-09-27 · Branch: `wip/renal-anatomy-practical` · Status: **code + schema complete, rehearsed on clone; NOT applied to live**

All gate results are after the last change (schema/0025 FK fix).

## 1. Quality Gate (final)

| Gate        | Result                                                       |
|-------------|--------------------------------------------------------------|
| Vitest      | **269 passing** / 34 files (baseline was 233 before this task) |
| TypeScript  | `tsc --noEmit` **0 errors**                                   |
| ESLint      | **0 errors**, 178 pre-existing warnings                      |

New test suites added this task: practical generate route (13), authoring helpers (17), practical gate/security (10), plus updated flashcards route idempotency (incl. cross-user + 409 conflict) and ai-quota case-evaluation regression.

## 2. Live `lms` — READ ONLY (nothing written)

- Migrations 0021–0025 **not applied** to live. 0023/0024/0025 exist on disk only (below).
- Read-only inventory: `practical_image` = 1 (labeled; markers>0; DRAFT_AI; subject Anatomy); `practical_question` = 10 (all LABELED_STRUCTURE, DRAFT_AI, all have image).
- Quota/Xp/log columns in live are untouched by this task.

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

**Deploy note:** apply 0023→0024→0025 in order via the Drizzle `drizzle.__drizzle_migrations` ledger; the chain is idempotent and clone-tested. Do NOT apply until the owner authorizes live migration.