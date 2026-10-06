# Practical Engine Generalization Plan

**Audit date:** 2026-09-13 (+03:00)
**Current branch:** `wip/renal-anatomy-practical`
**Current commit:** `5e1d705b72f468700210ab1c2b583a1980f1e106`
**Scope:** Current-source audit and implementation plan only. No application code, schema, database rows, curriculum, PDFs, mappings, or practical content were changed.

## Baseline and conclusion

`CURRENT_STATE.md` was read first. Its original audit header refers to commit
`0c78ec96b06f93b6245fcb8d82fefe4407d1e3f6`, while this practical pilot is on a
later commit. Consequently, this plan uses `CURRENT_STATE.md` for the protected
curriculum/safety baseline and the current branch source for pilot-specific
findings. It does not make a new claim about live database state.

The Renal Anatomy pilot is not a separate engine that must be rebuilt. Its
question validation, approved-content filtering, secure image delivery,
answering, feedback, wrong-question queue, bookmarks, difficult flags,
progress, idempotency, user isolation, and module entitlement check are already
largely generic. The blocking issue is discovery and scope: there is no
database entity that defines an available practical subject for a module, so
the current pages and service use the literal pair `rau-203` + `Anatomy`.

The minimum safe generalization is to add one database-backed module/subject
configuration entity, resolve every request through it, replace the two fixed
pages with parameterized routes, and associate existing OSPE stations with that
same configuration. Existing practical and OSPE engines should be reused.

## 1. Already generic and reusable

| Area | Reusable behavior | Evidence |
|---|---|---|
| Practical data | Images and questions already carry module, study year, subject, source provenance, review status, and fixture status. | `src/features/practical/schema.ts`, `drizzle/0014_renal_anatomy_pilot.sql` |
| Eligibility | A question is accepted only when its module/subject/year/image/markers agree; production requires approved question, approved image, and approved hashed sources. | `eligibleQuestion` in `src/features/practical/model.ts` |
| Student payload | Correct answer and teaching feedback are excluded before submission. | `studentQuestion` in `src/features/practical/model.ts` |
| Grading | Exact option IDs are graded server-side; no subject-specific grading logic exists. | `gradeChoice` in `src/features/practical/model.ts` |
| Store/query layer | Catalog queries filter by the supplied scope rather than a Renal table; progress is scoped by user and question. | `src/features/practical/store.ts` |
| Answer persistence | Submissions are transactional and idempotent, and feedback is returned only after the save completes. | `saveAnswer` in `src/features/practical/store.ts`; `answer` in `src/features/practical/service.ts` |
| Learner state | Wrong remaining, bookmark, difficult, attempts, correct, wrong, and accuracy work for any practical question ID. | `practical_progress`; `summarizeProgress` |
| Authorization | The practical service resolves the requested module through the shared module-access policy. A lecture preview does not unlock the practical bank. | `practicalService` in `src/features/practical/store.ts`; `getAccessibleModuleBySlug` |
| API behavior | List, answer, flag, and private image responses are generic operations with private/no-store headers. | `src/app/api/practical/**` |
| Image security | Real files are restricted to `private/practical-images`, MIME-allowlisted, and never fetched from content-provided URLs. | `src/features/practical/images.ts` |
| Practice UI | Image display, markers, zoom, option selection, saved feedback, navigation, wrong mode, flags, and progress rendering contain no Renal-specific business logic. | `src/components/practical-practice.tsx` |
| Fixture protection | Fixtures require development mode and remain separate from approved production content. | `fixturesAllowed`, `readPracticalImage`, practical service/store filters |
| OSPE core | The existing OSPE system already has authenticated module access, user-owned timed exams, station persistence, scoring, and answer-key/rubric support. It should be scoped, not rebuilt. | `src/features/ospe/**`, `src/app/api/ospe/**` |

The current practical model is reusable for **image-based single-choice** work
across the requested subjects. It is not yet a universal practical-question
model: every question requires an image and the allowed question types are
`LABELED_STRUCTURE`, `IMAGE_IDENTIFICATION`, and `STRUCTURE_RELATION`. That is a
content-format limitation, not a Renal access restriction. It should be
extended only when approved real content proves that a new format is required.

## 2. Still hardcoded to Renal

| Location | Renal-specific value or behavior | Effect |
|---|---|---|
| `src/features/practical/model.ts` | `PILOT_MODULE = "rau-203"` | Establishes a single allowed module globally. |
| `src/features/practical/service.ts` | Rejects any `moduleSlug` other than `PILOT_MODULE`. | Generic store/service operations cannot be reached for Respiratory, CVS, or future modules. |
| `src/app/curriculum/[slug]/page.tsx` | Shows the Practical entry point only when `mod.slug === "rau-203"`; label says `Renal Practical · Anatomy`. | Other modules cannot discover Practical even if content is later configured. |
| `src/app/curriculum/[slug]/practical/page.tsx` | Calls `notFound()` outside the pilot module and renders `Renal`/`Renal Practical` copy. | The subject-selection page is a Renal-only page. |
| `src/app/curriculum/[slug]/practical/anatomy/page.tsx` | Calls `notFound()` outside the pilot module and renders Renal-specific breadcrumb/header copy. | The practice route remains Renal-only even though it receives a module slug. |
| `src/components/practical-practice.tsx` | Builds API and navigation URLs with `module=rau-203` and `/curriculum/rau-203/...`; empty state says `Renal Anatomy`. | The reusable UI cannot be mounted for another module. |
| `src/features/practical/fixtures.ts` | Fixture IDs use `dev-renal-anatomy-*`. | Development test data is named for the pilot. This does not affect production but should not define generic routing. |
| `scripts/setup-practical-pilot.ts` | Selects only `WHERE slug = 'rau-203'`, requires exactly one Renal row, then creates Renal fixtures. | This is a pilot bootstrap, not a reusable content/configuration workflow. |
| `src/features/practical/pilot.test.ts` | The request and module IDs are Renal-specific; tests assert that other modules are rejected. | The test suite currently protects the pilot restriction rather than generic module behavior. |
| `src/features/ospe/data.ts` and shared access helpers | Folder-to-module mapping is a static object, including `RENAL: "rau-203"`. | Existing OSPE can handle several modules, but a new module still requires a code edit and cannot be discovered from practical configuration. |

`drizzle/0014_renal_anatomy_pilot.sql` has a Renal pilot name/comment, but its
four table definitions do **not** contain a Renal ID. Do not rename or rewrite
this historical migration.

## 3. Still hardcoded to Anatomy

| Location | Anatomy-specific value or behavior | Effect |
|---|---|---|
| `src/features/practical/model.ts` | `PILOT_SUBJECT = "Anatomy"` | Establishes a single allowed subject globally. |
| `src/features/practical/service.ts` | Rejects every subject other than the exact, case-sensitive string `Anatomy`. | Histology, Pathology, Microbiology, Physiology, and Biochemistry cannot reach the engine. |
| `src/app/curriculum/[slug]/practical/page.tsx` | Renders one manually authored Anatomy card and URL. | Available subjects are not discovered from database/content configuration. |
| `src/app/curriculum/[slug]/practical/anatomy/page.tsx` | The route segment itself is static `anatomy`; breadcrumbs and heading are Anatomy-specific. | A new subject requires a new page/component copy. |
| `src/components/practical-practice.tsx` | Uses `subject=Anatomy`, an Anatomy URL, and an Anatomy-specific empty state. | The otherwise generic learner UI is tied to one subject. |
| `src/features/practical/fixtures.ts` | Image/questions use `subject: "Anatomy"`; fixture banner says they are not verified anatomy questions. | The development fixture factory cannot exercise another configured subject. |
| `src/features/practical/pilot.test.ts` | Test scope is Anatomy and asserts Histology is rejected. | Tests encode the pilot boundary instead of generic subject resolution. |

The database `subject` fields are not fixed to Anatomy, but they are free text
with no canonical subject record or foreign key. This is not sufficient
generalization: spelling, capitalization, and display labels can drift, and the
UI has no authoritative way to list available subjects.

The existing OSPE model is also **not subject-aware**. `ospe_answer_key` and
`ospe_exam_station` identify a filesystem folder and filename, while the static
map resolves only folder to module. A mixed Renal folder cannot be reliably
split into Anatomy, Histology, Pathology, Microbiology, Physiology, or
Biochemistry using its folder name. Subject-level OSPE therefore requires an
explicit database association; inference from filenames is unsafe.

## 4. Minimum target architecture

### Database-backed practical track

Add a new additive `practical_track` table in the **next migration** (currently
expected to be `0015`, without changing `0014`). One row represents one
available subject inside one module.

Minimum fields:

| Field | Purpose |
|---|---|
| `id` | Stable internal scope used by content, routes, and OSPE. |
| `module_id` | Foreign key to `module`; authorization is inherited from this module. |
| `subject_slug` | Stable URL/config key such as `anatomy`, `histology`, or `pathology`. |
| `display_name_en` | Primary English label. |
| `display_name_ar` | Optional Arabic navigation label; medical question/answer content remains English. |
| `status` | `DRAFT`, `PUBLISHED`, or `ARCHIVED`; only `PUBLISHED` is discoverable in production. |
| `sort_order` | Database-controlled subject ordering. |
| `practice_enabled` | Enables Practice and its Wrong Questions queue. |
| `ospe_enabled` | Enables the subject-scoped OSPE entry point only when mapped stations exist. |

Add a unique constraint on `(module_id, subject_slug)`.

Add a nullable `practical_track_id` foreign key to `practical_image` and
`practical_question`, backfill only explicitly verified existing rows, and make
all new application writes require it. Keep the existing module/subject/year
columns during compatibility rollout; do not destructively rewrite pilot data.
After a separate integrity audit proves every real row is linked correctly, a
later migration may make the key mandatory. Do not infer a track from a loose
subject string during requests.

For OSPE, add an additive association such as
`practical_track_ospe_station(track_id, answer_key_id)`. This is safer than
guessing subject from the OSPE folder or filename and allows a station to be
explicitly reviewed before it appears under a subject. Add an optional
`practical_track_id` to new OSPE exam sessions so the selected subject scope is
persisted. Existing folder/file fields remain storage locators and preserve old
OSPE sessions.

Target relationship:

```text
module
  └─ practical_track (module + configured subject)
       ├─ practical_image
       ├─ practical_question
       │    └─ practical_progress / practical_submission (user-scoped; unchanged)
       └─ practical_track_ospe_station
            └─ ospe_answer_key / rubric / exam station (existing engine)
```

### Server resolution and authorization

Introduce one server-only resolver, for example:

```text
getAccessiblePracticalTrack(actor, moduleSlug, subjectSlug)
```

It must:

1. require authentication;
2. resolve module and track from the database;
3. require the track to belong to the requested module;
4. apply the existing module entitlement policy;
5. require `PUBLISHED` in production;
6. expose fixtures only in development and only after an explicit fixture request;
7. return the canonical track ID, module ID, study year, labels, and enabled modes.

Use the same resolver for list, answer, flags, image delivery, and
subject-scoped OSPE creation. Client-provided `module` or `subject` values must
never be treated as proof of availability or access.

The production subject list should come from published tracks and mode/content
availability, never from DRAFT/fixture questions and never from distinct loose
`subject` strings. A published Practice entry should require at least one
eligible approved question and readable approved image. A published OSPE entry
should require at least one explicitly associated station. Wrong Questions is
available whenever Practice is enabled, even when the current user's queue is
empty.

### Routes and UI

Replace the Anatomy-only page with one dynamic subject route:

```text
/curriculum/[moduleSlug]/practical
  -> database-configured available subjects

/curriculum/[moduleSlug]/practical/[subjectSlug]
  -> Practice / Wrong Questions tabs

/curriculum/[moduleSlug]/practical/[subjectSlug]/ospe
  -> existing OSPE exam engine restricted to that practical track
```

The module page should show one generic `Practical` link when at least one
published practical track has an available mode. The Practical landing page
should use the module's database name and render track cards from the database.
`PracticalPractice` should receive `moduleSlug`, canonical `subjectSlug`, and
display labels as props; it should never construct `rau-203`, `Anatomy`, or an
Anatomy route internally.

Keep `?mode=practice|wrong` if the smallest route change is preferred. OSPE
should remain a distinct route/session because it has timed-exam state and a
different question model. Both routes can still be presented as the three
subject modes requested by the product:

```text
Module → Practical → Subject → Practice / Wrong Questions / OSPE Exam
```

### Requested modules and subjects

No module or subject should be added to a TypeScript allowlist. Once the
generic code exists, the following are configuration rows, not new pages:

- Modules: Renal, Respiratory, CVS, and any future module present in `module`.
- Subjects: Anatomy, Histology, Pathology, Microbiology, Physiology, and Biochemistry.

A module exposes only the subjects actually configured and published for it.
The existence of a global subject name does not imply that every module has
that practical subject.

## Minimum implementation sequence

1. **Add configuration without touching content.** Create the additive
   `practical_track` and OSPE-association schema, plus nullable compatibility
   keys. Do not edit `0014`; do not seed or import questions in this step.
2. **Generalize the server boundary.** Remove `PILOT_MODULE` and
   `PILOT_SUBJECT` from request authorization. Resolve a published track from
   the database and pass `trackId` through `Scope`; retain all existing approval,
   fixture, source, image, transaction, and per-user protections.
3. **Generalize discovery and routes.** Replace the hardcoded module-page link,
   subject card, and `/anatomy` page with DB-driven discovery and a
   `[subjectSlug]` route. Parameterize `PracticalPractice` and genericize copy.
4. **Scope the existing OSPE engine.** Associate reviewed answer keys/stations
   with practical tracks, persist the selected track on new exams, select only
   associated stations, and authorize through track → module. Do not rebuild
   timers, exam persistence, scoring, rubrics, or ownership logic.
5. **Retire pilot-only setup from normal operation.** Keep
   `setup-practical-pilot.ts` and its fixtures clearly development-only, or
   replace it later with a schema-only command plus an explicit neutral fixture
   command. It must never become a production content importer.
6. **Convert tests from pilot rejection to generic matrix coverage.** Preserve
   all current security/persistence assertions, then test multiple in-memory
   module/subject tracks, unknown/unpublished tracks, module mismatch,
   entitlement boundaries, fixture exclusion, and subject-scoped OSPE station
   selection.

## Expected code surface for the future implementation

Minimum files likely to change:

- next additive Drizzle migration and `src/features/practical/schema.ts`;
- new practical-track query/resolver module;
- `src/features/practical/model.ts`, `service.ts`, `store.ts`, and `http.ts`;
- `src/app/curriculum/[slug]/page.tsx`;
- `src/app/curriculum/[slug]/practical/page.tsx`;
- replace `src/app/curriculum/[slug]/practical/anatomy/page.tsx` with
  `src/app/curriculum/[slug]/practical/[subjectSlug]/page.tsx`;
- `src/components/practical-practice.tsx`;
- OSPE schema/query/exam/access code only where track scoping is required;
- practical and OSPE tests.

Files that should not be redesigned for this task:

- curriculum, lecture, PDF, mapping, billing, and payment schemas/workflows;
- practical progress/submission semantics;
- secure image filesystem rules;
- existing OSPE timer, ownership, answer-save, rubric, and scoring behavior;
- original recovery/current-state reports.

## Acceptance criteria for generalization

- No runtime reference to `PILOT_MODULE`, `PILOT_SUBJECT`, `rau-203`,
  `subject=Anatomy`, or `/practical/anatomy` remains outside explicitly named
  legacy development fixtures/tests.
- A new module/subject combination can be made discoverable by a reviewed
  database configuration and approved content association, with no new page or
  service branch.
- Module Practical pages list only configured/published subjects and never use
  unapproved content or fixture rows for production discovery.
- Practice, Wrong Questions, images, answer feedback, bookmarks, difficult
  flags, progress, refresh persistence, and cross-user isolation behave exactly
  as in the pilot for every configured track.
- Subject route, API, image route, and OSPE exam all resolve the same canonical
  track and module entitlement.
- Subject-scoped OSPE exams cannot draw stations from another module or subject.
- Existing global OSPE sessions and historical practical data remain readable
  during migration.
- Production cannot request or enumerate development fixtures.
- No Microsoft Forms import, question generation, curriculum mutation, PDF
  mapping change, or payment activation is part of the generalization.

## Exact next implementation task

Implement only the additive `practical_track` configuration and its read-only
resolver/listing query, with unit tests for published/draft status, module
ownership, entitlement, and production fixture exclusion. Do not yet migrate
routes, associate OSPE stations, or add practical content. This creates the
single authoritative scope needed by every later step while keeping the
validated pilot behavior unchanged.
