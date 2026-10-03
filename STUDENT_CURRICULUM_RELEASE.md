# Student curriculum release policy

Verified 2026-10-03 (Africa/Cairo). Starting HEAD: `3d210cd`.
Branch: `wip/renal-anatomy-practical`.

## Policy

`src/features/hierarchy/student-curriculum-release.ts` is the single product-release configuration:
`STUDENT_RELEASED_ACADEMIC_YEARS = [1, 2]`.

Student discovery and access require BOTH a released study year and the existing authoritative academic-period association/date rules. Unknown/missing years fail closed. Years 3-5 stay hidden even if assigned an enabled, current period. Free content, previews and entitlements do not bypass release. Admin bypasses the student policy.

Year 2 is released at product level only. Its eight existing modules have no approved academic-period association and remain hidden. Do not map Years 2-5 to the Year-1 2026-2027 periods. Their future period records/dates remain OWNER_ACTION_REQUIRED; no periods or dates were created.

To release Year 3 later, change only the central configuration to include 3. It still needs owner-approved, actual period associations and valid dates; changing the release list alone must not publish unconfigured modules.

## Shared enforcement

- `academic-visibility.ts`: applies product release together with unchanged period, historical and Summer rules; Admin returns before filtering.
- `academic-visibility-server.ts`: minimal/partial ID guards resolve BOTH the actual database study year and period association. Plan discovery includes study year; no billing logic changed.
- `learning-access.ts`: existing entitlement/ownership/access guards carry the optional study year and delegate to that resolver.
- `curriculum/academic-curriculum.ts`: existing Dashboard/Modules/curriculum/year-selector loaders use the shared filter before returning results/counts.
- Existing Search, weekly planning, review/tool selectors, question-bank discovery, lecture/PDF/notes, tutor, flashcards/cases, Practical/OSPE and games access paths reuse these loaders or centralized learning access. No duplicate page-level year checks were added.
- `app/api/admin/modules/route.ts` retains its admin-only, unfiltered management query, separate from student discovery.

## Verification

Full current-worktree gates:
- `npm test`: 972/972 passed, 77 files; 42 new deterministic tests.
- `npm run typecheck`: PASS.
- `npm run lint`: 0 errors, 197 existing warnings; warnings not cleaned.
- `npm run build`: PASS; 9 existing filesystem-tracing warnings.

The tests prove released Years 1/2, hidden Years 3/4/5 even with active periods and valid entitlements, selectors/discovery/count filtering, direct module/lecture denial, actual Search and flashcard-generation route denial before AI/quota/persistence, partial-ID lookup protection, Year-2 date gating, Summer behavior and Admin bypass.

Authenticated student browser/runtime:
- Dashboard and Modules at 1440px and 375px visually inspected; no horizontal overflow. Only Year 1 appears; current-period count is 122 lectures across the three visible medical modules.
- Manual `/curriculum?year=3|4|5` cannot expose those years.
- Search, flashcards, cases, OSPE and battles load without hidden-year module/selector entries.
- All 26 actual Year-3/4/5 module URLs return 404.
- Sampled search requests for each Year 2/3/4/5 return no results; Practical requests return 403.
- Weekly plan returns only Year-1 curriculum references. References were checked by exact slug/DB relationship, not substring matching.
- No browser errors or failed application requests in this student run; health HTTP 200.
- There are no actual Year-3/4/5 lecture rows locally, so hidden-year direct lecture/tool denial is tested through the real authorization/route functions with deterministic in-memory fixtures, not fabricated DB curriculum.

Admin visual QA remains NOT VERIFIED: the accessible in-app browser tab is still on `/sign-in`; the owner's separately reported Admin login is not accessible to this browser tool. No credentials/session secrets were read or copied from that session. Code and deterministic tests confirm Admin bypass/all-five-year discovery; the management query reads all 44 modules. An authenticated Admin browser check of the management list is still required, and must not be claimed as passed from code evidence alone.

Evidence: `reports/student-release-qa.json`.
Local-only visual screenshots: `tmp/student-release-qa/{dashboard,curriculum}-{1440,375}.png`. These are not runtime dependencies and are intentionally not committed.

## Data safety

Enforced READ ONLY queries before/after:
- Modules: 44 -> 44.
- Lectures: 394 -> 394.
- Associated modules: 10 -> 10; unassociated: 34 -> 34.
- Whole-row fingerprints for module, lecture and academic_period match exactly using `md5(string_agg(to_jsonb(row)::text, '' ORDER BY id))`.

Database breakdown remains Year 1: 10 modules/248 lectures; Year 2: 8/146; Year 3: 9/0; Year 4: 7/0; Year 5: 10/0.

No curriculum, PDF, mapping, date, approval, account, authentication, payment or subscription records were edited; no seed/reset/import/migration executed. Ordinary existing-student sign-in for QA may create a normal authentication session. No account or password was changed. Unrelated WIP is excluded from staging.
