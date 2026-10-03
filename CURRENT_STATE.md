# VYLO — Current State Audit

**Audit date:** 2026-09-06 17:24:23 +03:00  
**Audited commit:** `0c78ec96b06f93b6245fcb8d82fefe4407d1e3f6`  
**Scope:** read-only code/database audit. No curriculum, PDF, or database mutation was performed.

## Executive status

The local database is no longer in the historical 2-module/6-lecture state. It currently contains 7 modules and 248 lectures with populated source content, PDF references, ranges, summaries, and mind maps. This matches the pre-loss lecture count, but it does **not** prove that all current PDF ranges are among the 186 historically verified mappings. The current database has 248 mapped ranges while the historical applied-mapping report attests to 186 (62 were intentionally skipped as LOW/ambiguous).

Production readiness is blocked by access-control gaps, unresolved PDF provenance, two unusably short lecture sources, and a failing lint gate. This audit did not attempt recovery or correction.

## Verification method and safety

- Inspected the requested package, status/recovery reports, mapping reports, migrations `0012`/`0013`, curriculum/lecture/dashboard/study-plan/review/practice/OSPE code, and recent Git history.
- Ran the exact package scripts: `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run lint`.
- Ran `npm.cmd run db:status` (PostgreSQL is running).
- Database checks were direct `SELECT`/schema-inspection queries only. No audit/apply/import/migration/reset/populate script was executed.
- `scripts/content-mapping-audit.ts` was not run because it writes report files; `scripts/apply-pdf-mappings.ts`, `scripts/import-content.ts`, extraction/generation scripts, reset scripts, and test-content scripts were not run.
- Original PDFs were not modified. No payment or Paymob path was activated.

## Code health

| Check | Result | Evidence |
|---|---|---|
| TypeScript | **PASS** | `npm.cmd run typecheck` (`tsc --noEmit`) |
| Tests | **PASS** | `npm.cmd test`: 4 files, 27 tests passed |
| ESLint | **FAIL** | 2 errors and 140 warnings; errors are `scripts/generate-source-quizzes.mjs:64` (`module` assignment rule) and `src/components/preference-controls.tsx:16` (`react-hooks/set-state-in-effect`) |

## Exact current database state

All values below are current local PostgreSQL values, not historical expectations.

| Entity/condition | Count |
|---|---:|
| Universities | 0 |
| Faculties | 0 |
| Academic-year hierarchy rows (`academic_year`) | 0 |
| Semesters | 0 |
| Distinct module study years | 1 (`study_year = 1`) |
| Modules | 7 |
| Lectures | 248 |
| Lectures with non-empty `lecture.content` | 248 |
| Lectures with non-empty `pdf_file` | 248 |
| Lectures with valid `pdf_page_start`/`pdf_page_end` | 248 |
| Lectures with `summary_json` | 248 |
| Lectures with `mindmap_json` | 248 |
| Lecture notes | 0 |
| Question banks | 7 (all `source-quiz-*`; no `ospe-*` question banks) |
| Questions | 740 |
| Completed quiz attempts | 0 (5 `in_progress` OSPE exams are separate) |
| Persisted flashcards | 24 (3 lecture IDs, 1 user) |
| Persisted clinical cases | 1 (1 lecture ID, 1 user) |
| Question-review/SRS rows | 0 |
| Question bookmarks | 0 |
| Lecture-progress rows | 0 |
| OSPE answer keys | 759 |
| OSPE rubric rows | 2,507 |
| OSPE exams | 5 (all `in_progress`) |
| OSPE exam stations | 50 |

Module totals are: AEH-101 47, PPG-102 36, PMB-103 39, RS-201 38, CVS-202 39, RAU-203 31, IBL-204 18 (248 total). All are currently `study_year = 1`.

The source-bound local generators produce at least one English flashcard and one clinical-case question for **247/248** lectures. `ibl-204-physiology-blood-indices` has only 13 characters and produces no usable generated card/case. The 24 persisted cards and one persisted case are user data, not synthetic curriculum.

## Content and PDF integrity

- Historical pre-loss evidence: 248 lecture inventory; 80 source PDFs; 171 HIGH + 35 MEDIUM candidates (186 verified); 42 LOW and 62 ambiguous mappings; 7 unprocessable PDFs; 49 orphan PDFs.
- `reports/pdf-mappings-applied.json` records `mappingsApplied: 186`, `mappingsSkipped: 62`, `errors: 0`.
- Current database: 248 distinct lecture PDF paths, all 248 referenced files exist under `C:\work\projects\lecture-pdfs`, and all 248 ranges satisfy `end >= start`.
- A conservative current-title/range comparison against the historical audit produced only **20 exact title+range matches**. **62 current lecture titles correspond to candidates historically marked LOW/ambiguous.** The comparison cannot establish provenance for the remaining current ranges; therefore the current 248 mappings must not be labelled “all verified.” No mapping was changed.
- Two current source texts are below 100 characters: `cvs-202-pathology-cardiovascular-diseases` (82) and `ibl-204-physiology-blood-indices` (13).
- Arabic characters were found in lecture content: 0 rows. Arabic characters occur in 2 `summary_json` rows and 2 `mindmap_json` rows: PMB bacterial-cell-structure and PMB general-virology. Question prompts, explanations, and options contain 0 Arabic rows.
- `public/study-cards` contains 248 SVG cards. The OSPE image tree contains 798 image files across seven folders, while database answer keys currently cover CVS, IBL, RENAL, and RESP.
- One heuristic “test” marker hit was the legitimate title `Pulmonary function tests I & II`; it is not evidence of synthetic content.

## Product-flow audit

Status means the current code/data path was inspected; it does not claim a full browser credential E2E run where none was performed.

| Flow step | Status | File/function evidence and limitation |
|---|---|---|
| Sign in | **NOT VERIFIED** | `src/app/sign-in/page.tsx` calls Better Auth email sign-in and `src/app/api/auth/[...all]/route.ts` exists. No real credential E2E was run in this read-only audit. |
| Choose academic year | **PARTIAL** | `AcademicYearSelector` persists `horus_study_year` and refreshes; only year 1 is currently available and the hierarchy `academic_year` table is empty. |
| Dashboard | **PARTIAL** | `src/app/dashboard/page.tsx` uses `requireUser`, curriculum, accuracy, review, and subscriptions. Current progress/quiz data are empty, so analytics are not exercised with learner activity. |
| Curriculum/module | **WORKING** | `getCurriculum` and `src/app/curriculum/[slug]/page.tsx` load the 7/248 current records and gate locked modules while exposing a first-lecture preview. |
| Lecture | **PARTIAL** | `src/app/lecture/[slug]/page.tsx` applies module access/first-lecture preview and renders source, summary, mind map, notes, and quiz links. Two sources are too short; PDF preview access is inconsistent with the PDF API. |
| Verified PDF segment | **PARTIAL** | The lecture page requires a valid range and the PDF API checks entitlement. Current ranges exist for 248 lectures, but provenance against the 186 verified historical report is unresolved. |
| Source text | **PARTIAL** | All 248 rows are non-empty and rendered through `MarkdownContent`; the two short rows are not study-complete sources. |
| Summary/mind map | **PARTIAL** | All 248 JSON fields are present and rendered, but two records contain Arabic text and semantic/source fidelity was not validated. |
| Lecture notes | **PARTIAL** | `/api/lecture-notes` authenticates and enforces module access or first-lecture preview, with user-scoped CRUD. Table is empty and no interaction E2E was run. |
| Flashcards | **PARTIAL** | `listLecturesForReview` and `/api/review/flashcards` require access; local source generation is ready for 247 lectures and 24 cards exist. Locked-module first-lecture preview is not allowed by this feature. |
| Clinical case | **PARTIAL** | `/api/review/cases` and local source evaluation are user/access scoped; 247 lectures are generator-ready and one case exists. No case-review history beyond that row is present. |
| Lecture/module quiz | **PARTIAL** | Server quiz pages call `hasModuleAccess` and 7 source banks/740 questions exist, but `/api/quiz/questions` returns any bank/module questions for any authenticated user without entitlement. |
| Correct/wrong feedback | **PARTIAL** | `QuizRunner` and `ReviewSession` display returned feedback. `/api/quiz/answer` and `/api/review/answer` lack the same entitlement guard; no completed attempts exist. |
| Bookmarks | **PARTIAL** | Auth/user scoping exists, but bookmark API and `src/app/quiz/bookmarks/page.tsx` do not re-check module entitlement, so expired paid bookmarks can still expose question content. |
| Spaced-repetition review | **PARTIAL** | SM-2 logic exists in `practice/queries.ts` and review UI exists, but there are 0 review rows; `/api/review/answer` can process an arbitrary question ID after authentication. |
| Progress updates | **PARTIAL** | `/api/curriculum/toggle` persists per-user progress, but does not verify lecture existence or entitlement; a user can mark a locked lecture complete by ID. Current progress rows: 0. |
| Dashboard analytics | **PARTIAL** | History/analytics pages and queries exist, but there are 0 completed quiz attempts. |
| OSPE | **PARTIAL** | Image/station routes enforce mapped-module access and 759 keys/2,507 rubrics exist. The generic exam POST does not check entitlement before creating stations, and reference PDFs under `public/ospe-pdfs` are static/public. No OSPE question banks exist. |
| Search | **PARTIAL** | `/api/search` authenticates, builds a BM25 index from `length(content) > 100`, and filters results by access/first lecture. Two short lectures are excluded; no live signed-in search E2E was run. |

## Daily study plan and exam-readiness reality check

`src/components/daily-study-plan.tsx` currently derives its three cards from exactly:

1. the next incomplete accessible lecture;
2. the due review-question count; and
3. the weakest module by quiz accuracy.

“Start today’s session” is only a `Link` to `primaryHref` (one lecture, `/review`, a module, or `/curriculum`). There is no persisted study-session table, session API, ordered task record, resume state, or completion event. The UI describes a session, but it does not create one.

`src/app/dashboard/page.tsx` computes:

```text
examReadiness = round(
  overall completion % * 0.45
  + completed-quiz accuracy % * 0.45
  + min(total answered / 100, 1) * 10
)
```

This is a descriptive weighted score, not a validated exam-performance predictor. The safer temporary product label is **Study Score**: show the three components, show “not enough data” when attempts are absent, and do not present it as a probability of passing. A future evidence-based readiness model would need at least exam date/blueprint weighting, syllabus coverage, recent timed mixed-form accuracy, question difficulty/novelty, recency and variance, spaced-repetition retention/backlog, confidence/calibration, minimum sample thresholds, and validation against actual exam outcomes.

## Access and security findings

Good guards were found on the lecture page, lecture notes, flashcard/case generation, search, OSPE image/station routes, and server-rendered quiz pages. The following gaps require fixing before production:

1. **Critical — `/api/quiz/questions`**: authentication only; it lists all banks and returns questions for arbitrary bank/module slugs without `hasModuleAccess`/free-preview checks.
2. **Critical — `/api/review/answer`**: authentication only; arbitrary question IDs can return explanations/correct answers and mutate review state without checking the question’s module entitlement.
3. **High — `/api/quiz/answer` / `gradeAnswer`**: no entitlement check at the API boundary, and grading does not assert that the question belongs to the submitted attempt’s bank.
4. **High — bookmarks**: `/api/quiz/bookmark` accepts arbitrary question IDs; `src/app/quiz/bookmarks/page.tsx` renders saved paid-question content without re-checking current entitlement.
5. **High — OSPE exam**: `/api/ospe/exam` calls `createExam`/`startExam` without checking mapped-folder entitlement. `public/ospe-pdfs/*` is static and bypasses authentication/entitlements entirely.
6. **Medium — progress integrity**: `/api/curriculum/toggle` has no lecture existence or module-access validation.

`/api/content/pdf/[lectureId]` is conservative (it requires entitlement), but it does not allow the first-lecture preview that the lecture page allows. Flashcard/case routes are also safe from paid leakage but do not share the lecture page’s first-preview rule. These are product-consistency issues, not reasons to relax access checks.

## Stale or historical documentation

- `DATABASE_STATE_REPORT.md`, `RECOVERY_EXECUTIVE_SUMMARY.md`, and `RECOVERY_SOURCE_AUDIT.md` describe the old 2-module/6-lecture/test-content state and are not current database truth.
- `IMPLEMENTATION_STATUS.md` claims content extraction is pending and lint is passing; both statements are stale. Its “171 HIGH + 15 MEDIUM” wording also conflicts with the mapping audit’s 171 HIGH + 35 MEDIUM breakdown.
- `reports/content-mapping-audit.json`, `reports/pdf-mappings-applied.json`, and `RECOVERY_SOURCE_AUDIT.json` remain valuable historical evidence, but their counts must not be substituted for current DB counts.

## Top five next priorities (after approval)

1. Centralize entitlement/ownership checks for quiz questions, quiz answers, review answers, bookmarks, and OSPE exam creation; add locked/free-preview route tests.
2. Reconcile current 248 PDF ranges against the historical 186 verified mappings and manually review the 62 LOW/ambiguous candidates. Do not auto-apply them.
3. Repair or explicitly quarantine the two short lecture sources and audit the two Arabic summary/mind-map records; do not synthesize medical content.
4. Replace the dashboard label/formula with the temporary Study Score presentation, then design a persisted ordered study-session model separately.
5. Clear the two lint errors and add authenticated integration coverage for sign-in, access boundaries, quiz feedback, review, notes, OSPE, and search before enabling production payments.

## Exact recommended next implementation task

Implement and test a single centralized, read-only-first entitlement guard (module access plus the explicitly documented first-lecture preview rule), then apply it to:

- `src/app/api/quiz/questions/route.ts`
- `src/app/api/quiz/answer/route.ts`
- `src/app/api/review/answer/route.ts`
- bookmark listing/toggle paths
- `src/app/api/ospe/exam/route.ts`

The task must include ownership/bank consistency checks and locked/free-preview integration tests, with **no curriculum/PDF/database recovery or mapping changes**. Obtain approval before implementing it, especially while the 248-vs-186 PDF provenance discrepancy remains unresolved.

## Explicit safety warnings

- Do not run `scripts/reset-curriculum.ts`, `scripts/populate-test-content.ts`, `scripts/import-content.ts`, `scripts/apply-pdf-mappings.ts`, extraction/generation scripts, or any destructive migration/reseed script during the next step.
- Do not overwrite original PDFs or auto-apply LOW/ambiguous mappings.
- Do not call the current 248 PDF ranges fully verified until provenance review is complete.
- Do not enable live payments or Paymob.
- No database rows were changed by this audit.

## Authoritative implementation update — 2026-09-07 00:30:32 +03:00

This update supersedes the **Access and security findings**, **Code health**,
and affected product-flow classifications above. The database counts and PDF
integrity evidence recorded in this file remain unchanged: this implementation
performed no database, curriculum, PDF, seed, mapping, import, or migration
operation.

### Completed access-control hardening

- Added `src/features/access/learning-access.ts`, the shared server-side policy
  layer. It resolves lecture → module, question → bank → module, and OSPE
  folder → module from the database; recognizes admin, free-module, and valid
  subscription access; allows only the actual DB-resolved first lecture as a
  preview; and verifies ownership for attempts, flashcards, cases, review
  records, and OSPE exams.
- Protected quiz bank/question listing, answer grading, attempt finishing,
  review feedback, bookmarks, quiz history/analytics, and due-review counts.
  A question must now belong to both the requested bank and the owned attempt
  before its answer can be graded.
- Protected lecture notes, progress toggles, tutor chat, flashcard/case
  generation and review, search, and their server-rendered lists with the same
  access policy. Expired access no longer reveals private generated study
  material or paid results.
- Protected OSPE exam creation/read/answer flows. Mixed exams may select only
  folders covered by the caller's current entitlement, and a station answer is
  bound to its specific exam.
- Replaced direct public OSPE PDF links with the authenticated
  `/api/content/ospe/pdf` route. `src/proxy.ts` blocks direct `/ospe-pdfs/*`
  static paths.
- Found and closed a second static-content bypass: summary SVGs in
  `public/study-cards` now load only through
  `/api/content/study-card/[lectureId]`; direct `/study-cards/*` paths are also
  blocked by the proxy.
- Hardened peer-challenge (battle) banks, joining, ready, answering, and
  finishing so the caller must be a participant with access to the matching
  bank/question.
- Disabled the former simulated purchase, Paymob checkout, and Paymob webhook
  routes. They now return HTTP 503 and cannot create payment records, make
  gateway calls, or activate subscriptions.
- Unified pages that had used the older subscription helper with the shared
  policy, including admin access. The theme preference control also no longer
  performs synchronous state-setting inside an effect.

### Current verification

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run test` | **PASS — 6 files, 43 tests** |
| `npm run lint` | **PASS with 126 non-blocking warnings (mostly pre-existing); 0 errors** |
| `git diff --check` | **PASS** (line-ending notices only) |

The new policy tests cover unauthenticated and unentitled denial, entitled,
admin, free-module, and first-preview allowance; bank/question consistency;
private-record ownership; OSPE folder mapping; and direct static OSPE PDF and
study-card blocking. They do not use or change the local database.

### Remaining production blockers

1. The 248 current PDF ranges still cannot be asserted as all historically
   verified against the 186-mapping report. The 62 LOW/ambiguous candidates
   require manual review; do not auto-apply anything.
2. No authenticated browser E2E test has exercised a real user/subscription
   matrix. The policy and route-level guards are implemented and unit-tested,
   but deployment requires an E2E authorization pass.
3. Content-quality blockers remain: two source texts are too short, and the
   documented Arabic summary/mind-map records need review.
4. The dashboard's “exam readiness” remains a descriptive weighted score, not
   a validated exam-performance predictor.
5. Lint is clean of errors but retains 126 non-blocking, mostly legacy warnings that
   should be addressed in a separate quality pass.

### Exact recommended next implementation task

Create authenticated integration/E2E coverage for the shared access matrix:
anonymous, unentitled student, valid subscriber, free-preview student, admin,
and a second user. Verify HTTP status and absence of protected response fields
for lecture PDF/source/summary card, quiz questions/answers/attempts,
bookmarks, review, flashcards, cases, OSPE PDFs/stations/exams, and battle
questions. Do not change curriculum data, PDFs, or payment state while doing
so.

## Authenticated E2E security verification — 2026-09-07 13:01 +03:00

This section is the authoritative result of the access-control test pass. The
test runner cloned the current `lms` database to a disposable `horus_e2e_*`
database, launched Next against that copy, created only fixture users and
private learning records there, and removed the copy after the run. The source
database, curriculum rows, PDFs, mappings, payment state, and original files
were not modified.

### Access matrix

| Actor / boundary | Result | Evidence |
|---|---|---|
| Anonymous | **PASS** | Direct PDF, quiz, notes, review, OSPE, battle, and search APIs returned authentication denial; browser lecture navigation redirected to sign-in. |
| Authenticated, no entitlement | **PASS** | Protected CVS lecture/PDF, quiz, notes, flashcards, cases, OSPE, and battle endpoints denied without protected fields. |
| Valid CVS-202 entitlement | **PASS** | Real protected PDF/source page, quiz, review, notes, flashcards, cases, OSPE, battles, and search access succeeded. |
| Administrator | **PASS** | Admin could read protected lecture PDF; private student quiz attempts remained owner-scoped. |
| First-lecture free preview | **PASS** | Preview-only actor could read only the DB-resolved first lecture PDF/page and private preview note; later lecture features stayed denied. |
| Cross-user isolation | **PASS** | Second user could not finish another user's quiz, answer its review, delete its note, review its flashcard, evaluate its case, or read/answer its OSPE exam. |

### Protected surface matrix

| Surface | Result | What was verified |
|---|---|---|
| Lecture page/source | **PASS** | Anonymous redirect, locked paid lecture without source text, entitled source section. |
| PDF | **PASS** | Anonymous/unentitled denial, first-preview allowance, entitled/admin retrieval; static PDF routes remain blocked. |
| Quiz | **PASS** | Bank access, answer fields hidden before submit, post-answer feedback, finish ownership, question-bank boundary. |
| Review/SRS | **PASS** | Own scheduled review works; another user's review answer is indistinguishable from not found. |
| Bookmarks | **PASS** | Access is checked and bookmark state remains per-user. |
| Notes | **PASS** | Auth/access checks and owner-scoped delete; cross-user delete cannot remove the owner's note. |
| Flashcards | **PASS** | Entitled source generation works; another user cannot review the card. |
| Clinical cases | **PASS** | Entitled source case/evaluation works; another user cannot evaluate the case. |
| OSPE | **PASS** | Allowed CVS exam starts; another user cannot read or answer its exam/station. |
| Battles | **PASS** | Entitled create/join/ready/answer works; unentitled inspection/answer is denied and participant access is scoped. |
| Search | **PASS** | Unentitled search returned no protected CVS lecture result/text. |
| IDOR protection | **PASS** | Attempt, question-bank, review, note, flashcard, case, OSPE exam/station, and battle ownership/boundary probes passed. |

### E2E and code-health results

- `npm run e2e:security`: **PASS — 61 passed, 0 failed** using Microsoft Edge through Playwright plus direct HTTP API calls.
- `npm run test`: **PASS — 6 files, 43 tests**.
- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS — 0 errors, 126 warnings** (warnings are existing unused values, explicit `any`, and hook/image guidance; they do not block the script).
- Browser console still reports an existing `PreferenceControls` theme hydration mismatch and the PDF viewer can warn when the external PDF worker is network-blocked. These are UI/reliability gaps, not observed access-control leaks.

### Security bugs found and fixed before this pass

The earlier audit identified missing access checks across quiz question/answer/review/bookmark paths, OSPE exam/static PDF paths, progress, and battles. The shared policy and route guards listed in the previous implementation update were applied and this E2E matrix found no remaining unauthorized-content or cross-user access failure in the exercised surfaces.

### Remaining security / production gaps

1. The E2E pass covers the CVS-202 paid module and the real CVS OSPE folder; other module-specific data should receive the same matrix before production.
2. The theme hydration mismatch should be repaired in a separate UI-quality task; do not treat its console warning as authorization evidence.
3. PDF provenance is still unresolved: current 248 ranges must not be called historically verified against the 186-mapping evidence.
4. Current local payments/Paymob remain disabled; no live payment state was exercised.

### Safety record

- No curriculum, PDF, mapping, seed, import, migration, payment, or production database operation was performed.
- The only database writes were fixture users/subscriptions and private practice records inside the disposable `horus_e2e_*` clone, which was removed after the test.
- Do not run reset/reseed/content-generation or automatic LOW/ambiguous PDF mapping scripts.

### Exact next implementation task

**PDF mapping provenance audit.** Compare current 248 lecture ranges against the
historical 186 verified mappings, manually review LOW/ambiguous candidates, and
do not auto-apply uncertain mappings. Do not begin that task automatically as
part of this security test pass.

## PDF mapping provenance audit — 2026-09-07 13:49 +03:00

This is the authoritative read-only provenance result for the current
curriculum. The audit queried the database with SELECT-only SQL, read each of
the 248 current split PDFs once for metadata/text evidence, and wrote only the
two provenance reports. No database row, mapping, PDF, or application source
was changed.

### Provenance classification

| Class | Lectures |
|---|---:|
| VERIFIED_HISTORICAL | **0** |
| VERIFIED_CURRENT_EVIDENCE | **137** |
| PLAUSIBLE_NEEDS_REVIEW | **101** |
| CONFLICT | **0** |
| UNVERIFIABLE | **10** |

The current database still contains 248 lecture rows, 248 PDF files, 248 valid
page ranges, 248 non-empty content fields, 248 summaries, and 248 mind maps.
All 248 current PDF files were present and all current ranges were valid; each
current split PDF uses its complete `1–N` page range. The audit found no current
overlaps, duplicate ranges, unexplained multi-lecture gaps, or reversed ranges.

### Historical reconciliation

The historical report contains exactly 186 HIGH/MEDIUM non-ambiguous mappings,
matching `reports/pdf-mappings-applied.json`. Strict comparison of all three
current tuple fields (`pdfFile`, `pdfPageStart`, `pdfPageEnd`) found **0 exact
matches**, **20 range-only matches**, **186 mismatches**, and **0 missing current
rows**. The later `split-compact-lecture-pdfs.mjs` workflow explains why the
current path/range changed to `lecture-pdfs/<lecture-slug>.pdf` and `1–N`, but
the repository has no per-lecture execution manifest proving the source tuple
for the 62 LOW/ambiguous candidates. Current mapping exists does **not** mean
mapping is historically verified.

### Short-source and review status

The two short sources remain flagged without regeneration: CVS-202
“Cardiovascular diseases” (content length 82) and IBL-204 “Blood indices”
(content length 13). The current PDF text for these sources is also very short
or non-extractable, so neither should be treated as a content-quality pass.
The generated manual-review queue contains 250 entries, including all
non-historical classifications, unresolved historical candidates, the two
short-source items, and any range-integrity findings.

See `reports/pdf-mapping-provenance-audit.json` for one canonical record per
lecture and `reports/pdf-mapping-provenance-audit.md` for the human-review
report. Do not fix mappings automatically; the next implementation task is a
manual evidence review of the 101 plausible/10 unverifiable lectures and the
62 historical LOW/ambiguous provenance cases, starting with the short sources.

## PDF LINEAGE RECONSTRUCTION — 2026-09-07 19:12:26 +03:00

This section is the authoritative result of the completed read-only lineage
reconstruction at commit `0c78ec96b06f93b6245fcb8d82fefe4407d1e3f6`. It
supersedes the earlier heuristic provenance totals above for lineage purposes;
historical recovery reports were not rewritten.

### Scope and safety

- Current inventory: **248** per-lecture PDFs; original report inventory: **80** source PDFs; **31** source PDFs were parsed for page fingerprints.
- Comparison used normalized per-page text SHA-256 fingerprints and contiguous sequence matching. Near-page Jaccard scores and page dimensions are review signals only.
- No database connection or mutation was performed. No curriculum row, mapping, original PDF, current PDF, OCR output, or generated content was changed.
- No LOW-confidence or ambiguous mapping was automatically approved.
- The split workflow identified in Git (`scripts/split-compact-lecture-pdfs.mjs`, commit `a631895`) emits per-lecture `lecture-pdfs/<slug>.pdf` files and resets ranges to `1–N`, but has no historical source manifest/log. Therefore exact lineage is reported only where the evidence supports it.

### Lineage classification (all 248 lectures)

| Class | Lectures |
|---|---:|
| CONFIRMED_HISTORICAL | **23** |
| CONFIRMED_RECONSTRUCTED | **187** |
| STRONG_NEEDS_HUMAN | **10** |
| AMBIGUOUS | **1** |
| UNRESOLVED | **26** |
| CONFLICT | **1** |

### Historical 186 HIGH/MEDIUM non-ambiguous mappings

| Historical status | Mappings |
|---|---:|
| CONFIRMED | **23** |
| CONTRADICTED | **142** |
| INSUFFICIENT | **21** |

The 142 contradictions are primarily caused by the historical report carrying
broad or full-document endpoint ranges while the current split PDFs use
`1–N`; they are not silently converted into approvals. The single explicit
source/range conflict (AEH-101 **GIT**) remains a conflict, not a correction.

### Historical 62 LOW/ambiguous mappings

| Lineage result | Mappings |
|---|---:|
| CONFIRMED_BY_LINEAGE | **49** |
| STRONG_CANDIDATE_NEEDS_HUMAN | **2** |
| AMBIGUOUS | **0** |
| NO_MATCH | **11** |

These records remain non-promoted unless a human confirms the generated
evidence pack. The one separate ambiguous lecture is AEH-101 **Axial &
Appendicular Skeleton**, where two distinct original ranges match exactly.

### Non-text PDFs

Of the **10** non-text or non-extractable current PDFs, **0** are visually
confirmed, **3** are likely candidates requiring human visual confirmation, and
**7** remain unresolved. Page dimensions alone are never treated as proof.

### Short sources requiring human review

- **CVS-202 — Cardiovascular diseases:** current PDF **19 pages**, extracted text **88 characters**; candidate `semester 2/CVS/CVS.pdf` pages **437–455**; cause `D_CANNOT_DETERMINE`.
- **IBL-204 — Blood indices:** current PDF **7 pages**, extracted text **13 characters**; candidate `semester 2/IBL/IBL.pdf` pages **151–157**; cause `D_CANNOT_DETERMINE`.

### Manual review pack

`reports/pdf-lineage-manifest.json` contains **38** review records only:
**1 CONFLICT**, **26 UNRESOLVED**, **1 AMBIGUOUS**, and **10
STRONG_NEEDS_HUMAN**. The Markdown report orders them in that risk order and
includes the current PDF, candidate source/range when available, evidence, and
a human verification instruction. No record in this pack is auto-approved.

### Top five next priorities

1. Manually review the 38-item pack, starting with the conflict and unresolved records.
2. Visually verify the 10 non-text PDFs and the two short-source candidates.
3. Reconcile the 142 historical endpoint contradictions against page-boundary evidence; do not rewrite the historical report.
4. After review, add a durable source/range manifest to the split pipeline so future rebuilds are auditable.
5. Re-run the complete authenticated access/content-quality checks only after reviewed lineage decisions are recorded.

### Explicit safety warnings

Do not run reset/reseed/content-generation or automatic LOW/ambiguous mapping
scripts. Do not overwrite or modify original PDFs or current split PDFs. Do
not treat a current `1–N` range, a near-text match, a page-dimension match, or
the existence of a summary/mind map as historical provenance. Production
content remains blocked pending manual review of the 38 records and the 10
non-text PDFs.

### Exact recommended next implementation task

**Manual evidence review of `reports/pdf-lineage-manifest.md`, beginning with
CONFLICT/UNRESOLVED records.** Record decisions in a separate reviewed artifact
before any mapping change; do not start that task automatically in this audit.

## HUMAN PDF REVIEW PACK — 2026-09-07 21:23:01 +03:00

The read-only review pack was generated from `reports/pdf-lineage-manifest.json`
at commit `0c78ec96b06f93b6245fcb8d82fefe4407d1e3f6`.

- Total requiring review: **38**
- CONFLICT: **1**
- UNRESOLVED: **26**
- AMBIGUOUS: **1**
- STRONG_NEEDS_HUMAN: **10**
- Non-text cases: **10**
- Dedicated short-source cases: **CVS-202 Cardiovascular diseases** (88 extracted characters) and **IBL-204 Blood indices** (13 extracted characters)
- Review tool: `reports/pdf-lineage-human-review.html`
- Review manifest: `reports/pdf-lineage-human-review.json`
- Review summary: `reports/pdf-lineage-human-review.md`
- Preview assets: `reports/pdf-lineage-human-review-assets/` (representative pages only)

The HTML is a local static tool. Verdicts are kept only in browser local state
until the reviewer exports or copies the decision JSON. The expected export is
`reports/pdf-lineage-human-decisions.json`; it is not applied automatically and
was not created during this audit.

No database, curriculum row, lecture mapping, PDF, lecture content, summary,
mind map, question, subscription, or payment was modified. The 210 confirmed
lineage records were not edited. Production content remains blocked until all
38 review records and the 10 non-text cases are manually verified. Do not run
mapping correction, reset, reseed, import, OCR, or content-generation scripts
as part of this review.

The final SELECT-only database verification could not connect because the local
PostgreSQL service is stopped (`npm.cmd run db:status` reported
`postgres is not running`). The existing read-only lineage manifest still
contains the expected 248-lecture inventory; the database was not started or
recovered automatically.

## OSPE HUMAN REVIEW — 2026-09-13 15:34:51 +03:00

- **Total stations:** 759 OSPE answer-key station definitions (plus 50 historical exam instances).
- **Reviewable with current evidence:** 759. Every definition has answer-key/rubric text; 529 also have an exact readable local image.
- **Missing-image-path issue:** 0. The workspace audit found no unique alternate path, case-only mismatch, or same-filename relocation for the 230 missing references.
- **Truly missing image:** 230 references are classified `REFERENCED_FILE_MISSING` by the conservative path/name audit. No file path was rewritten, and no visually similar file was guessed.
- **Needs human review:** 759. Existing reviewed station-track mappings remain 0; all content-derived subject labels in the review pack are explicitly non-binding suggestions only.

The local static review pack is available at `reports/ospe-human-review.html`, with canonical data in `reports/ospe-human-review.json` and a Markdown audit in `reports/ospe-human-review.md`. It supports an individual subject/verdict/note decision for every station, local browser persistence, filters/counters, and export as `ospe-human-decisions.json`. Exported decisions are not applied automatically.

No database mapping, curriculum row, PDF, OSPE image, answer key, rubric, practical track, entitlement, or OSPE availability setting was changed. OSPE remains disabled for the practical track pending controlled human-reviewed mapping.

### OSPE review continuation dependency

`reports/ospe-human-review-grouped.html` embeds all station, rubric, clustering, and decision-workflow data needed for review. Its 529 available image previews remain local and resolve through relative paths to the sibling content tree at `C:\work\projects\images` (798 files, approximately 238.86 MiB); that large source tree is intentionally not copied into Git. The review and decision export still work without those previews, while the existing 230 missing-image stations remain visibly `IMAGE_MISSING` and cannot become `READY_FOR_OSPE`.

## OSPE POST-REVIEW PIPELINE — 2026-09-13 21:51:07 +03:00

### Prepared

- `src/features/ospe/review-pipeline.ts` is a pure validator/planner for the future individual human decision export. It accepts only the documented seven subjects and three verdicts, rejects malformed/duplicate/unknown/deleted answer keys, prevents `Unknown` confirmation, detects conflicting decisions inside exact-duplicate groups, and rejects authoritative module/track or subject/track mismatches.
- Exact-duplicate reconstruction uses the same conservative boundary documented in the grouped review tool: explicit module, normalized prompt, complete answer key, ordered rubric, and configured source evidence. It reproduces the current review artifact's **114 exact groups / 593 stations**; image readiness remains station-specific.
- `npm run ospe:mapping:dry-run` is a database-read-only planner. When a future `reports/ospe-human-decisions.json` exists, it enforces a read-only database session, checks the recovered **7 modules / 248 lectures**, queries current answer keys and practical tracks with `SELECT` only, and writes `reports/ospe-mapping-dry-run.json` plus `reports/ospe-mapping-dry-run.md`.
- The plan distinguishes `READY_FOR_MAPPING`, `READY_FOR_OSPE`, `BLOCKED_ASSET`, and `MISSING_TRACK`; it never creates a missing track and never enables OSPE. A safety snapshot verifies module, lecture, station, and mapping counts are unchanged during generation.
- `OSPE_MAPPING_APPLY_PLAN.md` documents a later backup/checkpoint, validation, transaction, rollback, and post-verification process. It is intentionally non-executable: no apply command or database-writing script was added.
- Focused validation: **13 tests passed** in `src/features/ospe/review-pipeline.test.ts`; repository typecheck passed; focused ESLint passed with zero errors/warnings. The full application suite was not rerun because production code paths and database content were not changed.

### Still requires human decisions

- `reports/ospe-human-decisions.json` does not exist yet. This is an expected pre-review state: the dry-run command exits successfully without opening a database connection or writing misleading empty reports.
- A human must review/export the individual decisions. Only after that export may the command produce the two dry-run reports; any rejected decision must be corrected before a separately approved apply tool is considered.
- A valid confirmed subject with no matching existing module + subject practical track remains `MISSING_TRACK`. It is not mapped, no track is inferred or auto-created, and OSPE remains disabled.

**Database modified: NO. Mappings modified: NO. OSPE enabled: NO.**
