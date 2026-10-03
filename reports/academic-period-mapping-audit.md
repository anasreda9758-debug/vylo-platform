# Academic-period module mapping audit

Status: **BLOCKED — no safe new mappings available from existing data.**

Starting commit: `23d2cea3f4016a3e4d937a06b8a29cbe0b35bc4a`.
Branch: `wip/renal-anatomy-practical`.
SELECT-only snapshot: 2026-10-03T00:49:42.173Z; final verification: 2026-10-03T00:52:40.851Z.
Date/time comparisons: Africa/Cairo.

## Result and safety

| Measure | Before | After |
| --- | ---: | ---: |
| Modules | 44 | 44 |
| Lectures | 394 | 394 |
| Associated modules | 10 | 10 |
| Unassociated modules | 34 | 34 |
| New associations applied | — | 0 |
| Explicitly marked Summer modules | 0 | 0 |
| Summer associations applied | — | 0 |

All 34 unassociated modules have explicit curriculum years 2–5 and global terms 3–10, but **no explicit calendar-period target**. The local structured registry also has `academicPeriodId: null` for all 34. Only 2026–2027 TERM_1, TERM_2 and SUMMER periods exist. No TERM_3–TERM_10 records or other calendar-year period records exist.

This does **not** prove that a global Term 3 needs a period with type TERM_3: it could use a first-term calendar period if explicitly configured. That correspondence is not provided. Folding terms by odd/even parity, assuming calendar years from study years, or assigning dates would be an unsupported inference and could expose currently hidden future modules. No such inference was performed.

No application code, module names/slugs, curriculum ordering, published state, lecture content, PDFs, mappings, subscriptions, prices, access or visibility rules changed. No seed/reset/import/migration executed. Database queries ran in enforced READ ONLY transactions. Whole-row fingerprints for module, lecture and academic_period match exactly before/after. Ordinary browser login used an existing local test account; it can create a normal authentication session, not curriculum changes.

## Mapping evidence

- Actual local `module.study_year`, `module.term`, `module.order`, `module.academic_period_id`.
- Actual local `academic_period` IDs, calendar academic_year, type, enabled flag and raw Cairo timestamps.
- The `module.subject_id → subject → semester → academic_year` hierarchy is absent (NULL) for all 44 modules, including all 34 pending records.
- `scripts/data/horus-curriculum-2026.mjs` is existing **untracked unrelated WIP**, inspected as a static data registry only. Its explicit year/term/period IDs corroborate the 10 existing associations. Its 34 future-year records explicitly leave period IDs NULL.
- Calendar `academic_period.academic_year` (e.g. 2026–2027) is not curriculum `module.study_year` (1–5).
- The registry uses different official code aliases/order for some Year 2 Term 3 entries. Actual DB names, codes and ordering were preserved. JSON captures both sources; those differences do not supply period/date evidence.

## All academic periods

Dates below are timestamp-without-timezone values interpreted as Africa/Cairo wall time. Enabled=true does not mean current.

| ID | Calendar academic year | Type | Starts | Ends | Enabled |
| --- | --- | --- | --- | --- | --- |
| period-2026-2027-summer | 2026-2027 | SUMMER | 2027-07-01 00:00:00 | 2027-09-15 23:59:59.999 | true |
| period-2026-2027-term-1 | 2026-2027 | TERM_1 | 2026-09-01 00:00:00 | 2027-02-28 23:59:59.999 | true |
| period-2026-2027-term-2 | 2026-2027 | TERM_2 | 2027-03-01 00:00:00 | 2027-07-31 23:59:59.999 | true |

Summer overlaps Term 2 in July 2027; the existing visibility policy hides Summer during overlap. This existing configuration was not edited.

## Existing deterministic associations

All 10 already match explicit registry associations and existing period rows. None needs an update.

| Actual DB code/slug | Study year | Global term | Explicit period ID | Status |
| --- | ---: | ---: | --- | --- |
| ahe-101 | 1 | 1 | period-2026-2027-term-1 | VERIFIED |
| ppg-102 | 1 | 1 | period-2026-2027-term-1 | VERIFIED |
| pmb-103 | 1 | 1 | period-2026-2027-term-1 | VERIFIED |
| mt-104 | 1 | 1 | period-2026-2027-term-1 | VERIFIED |
| en-105 | 1 | 1 | period-2026-2027-term-1 | VERIFIED |
| rs-201 | 1 | 2 | period-2026-2027-term-2 | VERIFIED |
| cvs-202 | 1 | 2 | period-2026-2027-term-2 | VERIFIED |
| rau-203 | 1 | 2 | period-2026-2027-term-2 | VERIFIED |
| ibl-204 | 1 | 2 | period-2026-2027-term-2 | VERIFIED |
| uni-205 | 1 | 2 | period-2026-2027-term-2 | VERIFIED |

## Exact pending modules and deterministic mapping table

All rows below have target calendar year/period **UNRESOLVED** and require owner-confirmed correspondence. NULL target means **leave unmapped**, not create a period.

| Module ID | Actual DB code/slug | Actual name | Study year | Global term | DB position | Target period |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 6dfb0476-cf54-425e-883f-882fe525ef78 | git-301 | Gastro-Intestinal System (GIT-301) | 2 | 3 | 11 | NULL |
| 2697fd6a-bbae-453e-b36e-7c5f83dd28e3 | end-302 | Endocrine System (END-302) | 2 | 3 | 12 | NULL |
| 9bbc4f56-8313-480f-ae63-46ad76691bae | msk-303 | Musculoskeletal System (MSK-303) | 2 | 3 | 13 | NULL |
| 56d2f27c-17f8-4992-9c89-75e97ed732bb | nut-304 | Nutrition & Metabolism (NUT-304) | 2 | 3 | 14 | NULL |
| 2431dfbd-2bf2-4007-a362-8394aebbd19e | ens-401 | Central Nervous System and Special Senses (ENS-401) | 2 | 4 | 15 | NULL |
| 5da8c1c6-6927-48c2-baa4-28bb1ab9faa0 | mss-402 | Reproductive System (MSS-402) | 2 | 4 | 16 | NULL |
| 662b6f97-373d-4a12-9080-66b3697f0629 | gis-403 | Research Methodology, Evidence-based Medicine, and Biostatistics (GIS-403) | 2 | 4 | 17 | NULL |
| 697dc292-1465-4622-9324-7d11696ee5cf | nms-404 | Early Clinical Experience, Communication Skills, and Ethics (NMS-404) | 2 | 4 | 18 | NULL |
| d05dda73-1ded-4110-a866-c6f97a5d0e28 | epd-501 | Epidemiology of Infectious Diseases and Preventive Medicine (EPD-501) | 3 | 5 | 19 | NULL |
| 714f59ae-e72e-40bd-8d1a-9d6f5f61a978 | inf-502 | Infectious Agents and Principles of Management (INF-502) | 3 | 5 | 20 | NULL |
| 7870a3c3-9f69-4942-bcd7-b4a5f402fc4b | trp-503 | Tropical Medicine and Liver Diseases (TRP-503) | 3 | 5 | 21 | NULL |
| 6ffd75cc-6ca3-4013-a0f1-ff07fd7c2947 | bsp-504 | Basic Medical Skills and Professionalism (BSP-504) | 3 | 5 | 22 | NULL |
| a4ef3a4c-c0b1-4af0-a41d-65d107b9f426 | e-1 | Elective (I) (E-1) | 3 | 5 | 23 | NULL |
| 1a2f0eff-8ac4-4bf2-bd70-4d26ab62512e | com-601 | Community Medicine and Public Health (COM-601) | 3 | 6 | 24 | NULL |
| 9eb1ed29-3a50-4c7a-95af-58b81594bed7 | ctf-602 | Clinical Toxicology & Forensic Medicine (CTF-602) | 3 | 6 | 25 | NULL |
| 2a524ade-7bfb-4398-a41c-d00f3a10995d | ms-603 | Medicine (I) & Surgery (I) (MS-603) | 3 | 6 | 26 | NULL |
| 606419b9-6b05-4e0d-b95c-04dfb346747e | e-2 | Elective (II) (E-2) | 3 | 6 | 27 | NULL |
| b00ecabf-2a4c-4ce5-b1e5-1aa46f726494 | ms-701 | Surgery (II) and Medicine (II) (MS-701) | 4 | 7 | 28 | NULL |
| efae98c5-63d8-463e-bacb-a73f2d84381b | ped-702 | Pediatrics (I) (PED-702) | 4 | 7 | 29 | NULL |
| 049209e7-90df-4c34-a1a2-2ec88f17af04 | ogy-703 | Obstetrics and Gynecology (I) (OGY-703) | 4 | 7 | 30 | NULL |
| 692f73d9-af0d-473b-aa5f-bab47f6abd8e | e-3 | Elective (III) (E-3) | 4 | 7 | 31 | NULL |
| 030115ef-8ecd-4f40-810b-0810581b8df5 | ms-801 | Surgery (III) and Medicine (III) (MS-801) | 4 | 8 | 32 | NULL |
| add84899-c3b5-4153-9247-b88604e34e8d | ped-802 | Pediatrics (II) (PED-802) | 4 | 8 | 33 | NULL |
| 323fcc9a-208a-4cf7-b936-8ea630a50172 | ogy-803 | Obstetrics and Gynecology (II) (OGY-803) | 4 | 8 | 34 | NULL |
| 652890e6-f97f-45a6-9fb3-036e4bbee242 | ent-901 | Ear, Nose and Throat (ENT-901) | 5 | 9 | 35 | NULL |
| 8297c858-4713-4ec4-9bbf-538e12faf930 | opt-902 | Ophthalmology (OPT-902) | 5 | 9 | 36 | NULL |
| 71cdc069-6021-43fc-b1f4-5133b1025f21 | fmi-903 | Family Medicine and Integrated Management of Common Illnesses (FMI-903) | 5 | 9 | 37 | NULL |
| 57a5c4ba-75d2-492d-acdb-8c8f22d52f00 | lmr-904 | Laboratory Medicine and Radiology (LMR-904) | 5 | 9 | 38 | NULL |
| 9cd51a1b-eb87-4527-8a07-defb31dc960e | e-4 | Elective (IV) (E-4) | 5 | 9 | 39 | NULL |
| fe1ea485-3d8c-468c-b943-e4ec00e88606 | sur-10-1 | Surgery (IV): Surgical Oncology - Anesthesia and Intensive Care - Accident and Emergency (SUR-10-1) | 5 | 10 | 40 | NULL |
| a73d4257-fbb9-4715-a750-b9b83f15e67b | nps-10-2 | Neuroscience and Psychiatry (NPS-10-2) | 5 | 10 | 41 | NULL |
| 4a4b6e09-bbc8-4392-b528-e853da6e7090 | med-10-3 | Medicine (IV): Medical Oncology - Critical Care and Patient's Safety (MED-10-3) | 5 | 10 | 42 | NULL |
| 7b9cc249-0622-4c90-ac80-47d336b2c557 | dan-10-4 | Dermatology and Andrology (DAN-10-4) | 5 | 10 | 43 | NULL |
| fa3c1651-581c-4177-9583-da6462c8d3aa | gp-10 | Graduation Project (GP-10) | 5 | 10 | 44 | NULL |

The JSON companion contains each row's subject/semester/hierarchy fields, source-registry code/year/term/position, evidence and reason.

## Current-date verification

Real Cairo date/time: 2026-10-03T03:52:04.250. Current period: `period-2026-2027-term-1`.

- Authenticated student browser: Dashboard and Modules return HTTP 200 and show the three intended current medical modules (`ahe-101`, `ppg-102`, `pmb-103`).
- Both expose only Academic year 1. Future modules absent; Summer absent. Querying `/curriculum?year=2&term=3` cannot reveal pending future modules.
- The additional Term 1 associations `mt-104`/`en-105` remain excluded by existing unrelated owner-approved university/faculty requirement visibility. No intended currently configured medical module disappeared.
- Eligible past periods: none in current DB. Existing policy/tests retain historical regular-period visibility; no dates were changed to simulate a past/current boundary.
- Runtime browser errors: 0; unexpected failed application requests: 0; health endpoint: HTTP 200.
- Admin: actual policy evaluated against all DB modules returns **44** (including the 34 unassociated records and future Term 2). All 3 periods are read unfiltered by the admin-only academic-period endpoint. The admin modules GET lists all modules without a visibility predicate. These are SELECT/policy/API-code checks; **authenticated admin UI was NOT verified** because legitimate admin login was not available. No credentials, roles or verification state were changed.
- No explicitly marked/associated Summer modules exist, so admin Summer-module UI cannot be demonstrated with current content.
- Existing current-only and current-plus-past policy tests passed with the full suite.

## Quality gates

| Command | Result |
| --- | --- |
| `npm test` | PASS — 930 tests, 75 files |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors, 197 existing warnings |
| `npm run build` | PASS — 9 existing filesystem-tracing warnings |

Full gates include preserved unrelated WIP; these results do not claim that WIP was committed. No mapping test or application change was needed because there is no safely applicable new mapping. Initial `tsx` browser probe hit Windows `uv_os_get_passwd ENOMEM`; rerunning with Node's built-in TypeScript support succeeded without changing application code.

## Required owner input before any association update

For Study Year 2 Terms 3/4, Year 3 Terms 5/6, Year 4 Terms 7/8, and Year 5 Terms 9/10, provide explicit target academic_period IDs and calendar academic-year correspondence. Confirm whether they share the 2026–2027 first/second-term calendar periods or require future calendar periods; **neither was assumed**.

If targets do not exist, provide approved Cairo start/end dates and separate authorization to create periods. This task authorizes association updates only, not period creation/date guesses. Summer must be explicit.

A later approved association update must use a transaction, recheck 44 modules/394 lectures and 10 mapped/34 unmapped, match exact module IDs and validated target period IDs, update **only academic_period_id** (including preserving updated_at and all other fields), and compare counts/whole-row-excluding-association fingerprints afterward. Do not run the historical migration chain or seed scripts.

This audit does not contain an executable write plan. The 34 unassociated modules remain fail-closed until authoritative configuration is supplied.
