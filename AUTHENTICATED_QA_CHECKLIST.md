# VYLO authenticated QA — owner action required

No authenticated Student/Admin browser session was available during this task. This is **NOT VERIFIED**, not a platform FAIL. Never send passwords, OTPs or session tokens.

Use the prepared isolated HTTPS staging environment after its owner setup checks. Sign in yourself. Repeat layout checks near 1440px and 375px. Stop on an unexpected content leak; do not change curriculum, accounts or approvals to make a test pass.

## Student — expected PASS

- Dashboard and Modules load without clipping/overflow or failed application requests; current Year-1 content follows its active period.
- Year 2 is hidden while unmapped; Years 3–5, future Term 2 and inactive Summer are absent. Direct links to them do not reveal lecture text, PDFs or saved derivatives.
- An entitled, currently visible lecture and its protected PDF work. A copied PDF link without access is denied; no public/static alternate works.
- Tutor uses only accessible current sources. An inaccessible lecture/source request is denied without protected context or titles.
- Own saved flashcards/cases, notes, quiz history, bookmarks and review load. Previously saved paid/hidden/future sources are not returned once access is absent.
- Where two legitimate isolated Student sessions and existing safe records are available: B cannot load or update A's card, case, attempt or OSPE exam by changing its ID. A note-delete request as B must not delete A's note; generic success/no-op is acceptable. Neither account sees the other's private lists. Do not fabricate or alter accounts.
- Training/review/progress actions retain the legitimate student's state after refresh; no other user's state appears.
- Hosted AI, if explicitly enabled for staging, has the shared 15/day limit for free/subscribed/Admin accounts. Do not make 15 paid calls just to test it: use existing exhausted safe staging state if available; otherwise record runtime quota QA as unverified (deterministic quota tests pass).
- No card or Practical draft/fixture becomes available merely by changing URL/query inputs. Keep unreviewed OSPE unavailable.
- Sign out and verify protected pages deny access.

## Admin — expected PASS

- `/admin` opens; student controls cannot confer management privileges.
- Curriculum/Academic Periods management shows Years 1–5 and all 44 modules (394 lectures in the recovered baseline), without accidental student-release filtering.
- Hidden/future curriculum and protected resources remain available under the existing Admin policy.
- Admin is not granted access to another user's private case/card/quiz/OSPE state merely by its role.
- Desktop/mobile management navigation remains usable; do not edit records during QA.
- Secure/HttpOnly/SameSite cookie and redirect checks are completed on real HTTPS; no insecure alternate authenticated HTTP endpoint exists.

Record PASS/FAIL/NOT VERIFIED for each item and the deployed commit. Any unavailable entitlement, second session or safe quota fixture is OWNER ACTION REQUIRED, not permission to change credentials or data.
