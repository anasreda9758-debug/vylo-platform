# Future academic periods — OWNER_ACTION_REQUIRED

Owner decision recorded and read-only verification completed at 2026-10-03T00:58:28.729Z (2026-10-03T03:58:28.729, Africa/Cairo).
Repository: `wip/renal-anatomy-practical`, HEAD `3d210cda82e7770f3360b1f9ddca62312dcbedfc`.

## Authoritative owner decision

- Existing 2026–2027 academic periods belong to **Study Year 1 only**.
- Keep all 10 existing Year-1 module associations unchanged.
- **Never associate a Year 2–5 module with any existing 2026–2027 period.**
- Each of Years 2, 3, 4 and 5 requires its own future academic-year periods.
- Until the owner supplies approved dates and calendar-year labels, leave all 34 Year 2–5 modules intentionally unmapped.
- Existing fail-closed student visibility remains in force. Admin may still see/manage these modules.
- Do not create placeholder/fake database periods, infer calendar years or dates, or assign Summer without explicit evidence of actual use.
- No curriculum, module, lecture, PDF, mapping, billing, access or visibility-rule changes are needed now.

This decision supersedes the unresolved shared-versus-separate-year question in the historical `reports/academic-period-mapping-audit.md` / JSON. Those audit snapshots remain unchanged.

## Future period requirements (documentation only)

All entries below have status **OWNER_ACTION_REQUIRED**. They are conceptual requirements, **not database rows or an executable mapping plan**.

| Study year | Existing global curriculum term | Future period |
| --- | ---: | --- |
| Year 2 | 3 | Term 1 in Year 2's own future academic year |
| Year 2 | 4 | Term 2 in Year 2's own future academic year |
| Year 3 | 5 | Term 1 in Year 3's own future academic year |
| Year 3 | 6 | Term 2 in Year 3's own future academic year |
| Year 4 | 7 | Term 1 in Year 4's own future academic year |
| Year 4 | 8 | Term 2 in Year 4's own future academic year |
| Year 5 | 9 | Term 1 in Year 5's own future academic year |
| Year 5 | 10 | Term 2 in Year 5's own future academic year |

Existing global term numbers are recorded for reference only; they were not rewritten.

Conditional Summer requirements:

| Study year | Future Summer period | Status |
| --- | --- | --- |
| Year 2 | Only if actually used and explicitly confirmed | OWNER_ACTION_REQUIRED |
| Year 3 | Only if actually used and explicitly confirmed | OWNER_ACTION_REQUIRED |
| Year 4 | Only if actually used and explicitly confirmed | OWNER_ACTION_REQUIRED |
| Year 5 | Only if actually used and explicitly confirmed | OWNER_ACTION_REQUIRED |

Eight regular periods will eventually be needed. Up to four Summer periods are conditional, not approved for creation.

For every future period, the database ID, calendar academic-year label, start/end dates and activation configuration remain **unassigned/unapproved**. Do not infer dates or calendar-year labels such as 2027–2028 from the study-year number.

## Owner input required before future setup

1. Approve each study year's actual future calendar academic-year label.
2. Approve Term 1 and Term 2 start/end dates in Africa/Cairo.
3. Confirm Summer use separately per year; supply dates and explicit participating modules only if used.
4. Authorize the later creation of those period rows and exact module associations.

Any later setup must preserve all Year-1 associations, curriculum and lecture rows, use a transaction, and verify counts and fingerprints. Visibility remains governed by the existing date/access rules; this document does not alter them.

## Verified safe current state

SELECT-only inspection used an enforced READ ONLY transaction. The existing visibility policy was evaluated against actual database records and real Cairo time.

- Modules: **44**; lectures: **394**.
- Year 1: **10 mapped**, with every association matching the previous audit.
- Years 2–5: **34 intentionally unmapped** (Year 2: 8; Year 3: 9; Year 4: 7; Year 5: 10).
- Year 2–5 modules linked to 2026–2027: **0**.
- Year 2–5 modules visible to normal students: **0**.
- Current period: `period-2026-2027-term-1`.
- Current Year-1 medical modules: `ahe-101`, `ppg-102`, `pmb-103`. The already-approved requirement-module exclusions for `mt-104` / `en-105` remain unchanged.
- Year-1 Term 2 remains future/hidden. Summer remains inactive by dates/hidden.
- Admin visibility policy permits all **44** modules; authenticated admin browser UI was not retested.
- Academic-period rows remain **3**, exactly the existing Year-1 records.
- Whole-row fingerprints of module, lecture and academic_period match the previous audit: no data or dates changed.
- No application-code changes, seeds, resets, imports, migrations, association writes or fake period creation.

Only this documentation file was added. No commit or push was performed for this owner clarification.
