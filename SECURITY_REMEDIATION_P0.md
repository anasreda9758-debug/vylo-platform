# VYLO — P0 Security Remediation

Date: 2026-10-03, Africa/Cairo. Scope: SEC-001, SEC-002 and SEC-003 from the existing `SECURITY_AUDIT.md`. No general hardening, payment rollout or curriculum changes.

## 1. Starting HEAD

- Branch: `wip/renal-anatomy-practical`.
- Starting HEAD: `ce0403ab532cf982cc6ef41038c4083743821f44`.
- Existing 26 tracked modifications and substantial untracked WIP were preserved. Remediation targets were clean before this task.

## 2. Findings addressed

| Finding | Code status | Verification boundary |
|---|---|---|
| SEC-001: protected PDF shared caching | Fixed at protected route and local/S3 storage defaults | Route and driver tests plus unauthenticated live HTTP; actual CDN bypass/purge still needs deployment verification |
| SEC-002: unauthorized Tutor retrieval context | Fixed before prompt and source-header construction | Actual route using real central access/academic policy with mocked IO; no real hosted call |
| SEC-003: subscribed Tutor quota bypass | Fixed: finite atomic shared budget for every actor | Actual route regression and deterministic concurrent quota tests; no real usage-counter writes |

The related late-reservation path in Practical (SEC-010) was secured because every exposed hosted generation path must reserve before cost. Its unrelated module-ID/slug blocker, source authoring policy and OSPE functionality were not redesigned or enabled.

## 3. PDF vulnerability root cause — BEFORE

`streamFile()` returned `public, max-age=86400, s-maxage=604800` for both local and S3 content. `/api/content/pdf/[lectureId]` returned that response unchanged after authorizing one actor. A configured shared cache could reuse the protected response for another actor without origin authorization. A live CDN exploit was not performed in the audit or this task.

## 4. PDF fix — AFTER

- Both storage drivers now default to `Cache-Control: private, no-store` and `Vary: Cookie, Authorization`.
- The protected route independently enforces those headers on success and handled 401/404 responses, even if storage supplies a public policy.
- It also sets `CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store`.
- `dynamic = "force-dynamic"` explicitly prevents Next route prerender/response caching.
- Streaming body, MIME type, content length, existing PDF paths and legitimate first-lecture preview behavior remain intact.

Evidence: `src/shared/storage.ts:150-219`; `src/app/api/content/pdf/[lectureId]/route.ts:6-41`.

## 5. PDF authorization enforcement location

The existing server session and `getAccessibleLecture(session.user, lectureId, { allowPreview: true })` remain the authority. That helper checks current trusted DB module/lecture relationships, `[1,2]` release policy, Academic Period visibility, entitlement and the actual first ordered lecture preview; Admin retains its role-bound exception. A client ID selects a resource, never authorizes it. Access precedes storage.

No parallel policy or entitlement implementation was created. Existing public OSPE-reference/card proxy blocking remains unchanged. The only `streamFile()` route caller found is the protected PDF route; no public/static lecture-PDF alias was added. Actual S3 bucket ACLs and alternate static/CDN origins remain outside local verification.

## 6. PDF cache policy after fix

```text
Cache-Control: private, no-store
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
Vary: Cookie, Authorization
```

**Owner deployment action:** configure the actual CDN/reverse proxy to bypass `/api/content/*` authentication-dependent responses; do not override these headers with cache-everything rules. If any deployment cached responses under the old public policy, purge them before inviting external testers. New origin headers cannot invalidate an already cached old object. No CDN account/configuration was changed or claimed verified.

## 7. Direct PDF bypass tests

PASS in deterministic actual-route tests using the real centralized policy:

- Anonymous 401 before storage; unauthorized paid lecture 404 without title/path disclosure.
- Entitled student 200 with PDF MIME/body preserved and private/CDN no-store headers.
- Identical copied URL: entitled A gets 200; unentitled B gets 404; anonymous gets 401; storage called only for A.
- Preview ID allowed; changing to the paid lecture ID denied.
- Years 3, 4, 5, unmapped Year 2, future term and inactive Summer denied even with entitlement.
- Admin hidden-year access retained; revoked entitlement rechecked on next request.
- Local and mocked S3 drivers both private/no-store; traversal outside the content root denied; existing direct static proxy denial retained.

Live unauthenticated `/api/content/pdf/p0-nonexistent` returned 401 with `private, no-store`. This does not substitute for live authenticated PDF/CDN testing.

## 8. Tutor vulnerability root cause — BEFORE

Only the selected entry lecture was authorized. Module-filtered global RAG hits were then attached wholesale to the hosted prompt and `X-Sources`. A student entering an available free preview could retrieve other paid lecture text from the same module. The audit did not prove a cross-module/future-year bypass.

## 9. Tutor context authorization — AFTER

For each of at most six retrieval candidates the route calls the existing `getAccessibleLecture` with the authenticated server actor and preview policy. Denied, missing/deleted or contentless sources are discarded before prompt/header construction. The current DB source must belong to the entry module's authoritative ID and agree with its current module slug. Source titles/slugs come from that trusted DB result, not cached index metadata.

Context is bounded to 2,000 characters per candidate and 8,000 total; authorized entry fallback remains bounded to 8,000. The request body is capped at 256 KiB before JSON allocation, including streamed bodies without a trustworthy Content-Length; existing 20-message/4,000-character field limits remain. Client-supplied role/user/subscription/module/content/PDF extras cannot grant access or supply server curriculum context. Ordinary user conversation remains untrusted model input and never controls server tools/authorization.

Evidence: `src/app/api/tutor/chat/route.ts:117-204`, `src/shared/bounded-json.ts`, `src/features/access/learning-access.ts:116-148`.

## 10. Hidden curriculum Tutor tests

PASS: Years 3–5, future term, inactive Summer and unmapped Year 2 are denied as entry resources before retrieval/quota/provider/streak/usage writes. The same resources as retrieved candidates are omitted without titles/text in the prompt or source header. Deleted and cross-module candidates are excluded. Admin still accesses its hidden-year lecture/context, with a finite AI budget.

**Publication-policy limit:** the current lecture/module schema has no independent unpublished/private flag (already documented in the audit). This task does not invent a publication system or change content. All authorization states that exist today are reused; do not insert confidential draft lecture text into a released module and assume a nonexistent publication flag protects it.

## 11. Paid-content Tutor tests

PASS: direct unentitled non-preview entry denied; authorized visible entry works. A free-preview request with a denied same-module source no longer sends its text/title to the provider or `X-Sources`. Entitled subscribers retain accessible paid context. Forged client userId/role/subscription/content/PDF/module values do not change either context authorization or whose budget is charged.

## 12. AI quota vulnerability root cause — BEFORE

Tutor skipped reservation whenever `hasAnySubscription` was true. There was no alternative finite subscriber budget. The shared helper also allowed a non-reserving legacy check when `ai_usage_daily` was missing. Practical called the provider before reserving, then ignored a late reservation failure. Provider cost could therefore occur outside the enforced counter.

## 13. AI quota enforcement — AFTER

- Tutor reserves the existing shared `study_generation` budget for every actor, including subscribers and Admin, before the external call. Subscription still determines content entitlement, not unlimited AI.
- Existing limit stays **15 operations per Cairo day**, shared across Tutor, flashcards, case generation, hosted case evaluation and Practical. No prices, plan records, subscription grants or unlimited-plan design were introduced.
- Existing PostgreSQL transaction + per-user/day/bucket advisory transaction lock serializes read/check/increment. The existing unique counter key remains the DB boundary. No migration is needed.
- Limits must be integral and within 1–15. Malformed/missing counters, DB failures or unconfirmed increments throw; hosted work cannot fall back to an unreserved legacy count.
- Tutor returns 503 for unavailable quota, 429 for exhaustion, before provider/streak/usage calls. Practical propagates unavailable quota through its existing safe 503 handler and returns 429 on exhaustion before provider/generated drafts.
- A reserved provider attempt remains charged even if the provider fails or its output is invalid: retries can cost and cannot regain a free slot. Fresh/duplicate requests without a replay cache each require a new slot. This is budget enforcement, not a new general response-cache system.
- Existing keyed flashcard/case/Practical idempotent replay is retained; completed replay does not perform another AI call or charge. Changing/omitting a key cannot evade the shared finite counter.
- Practical requires explicit hosted opt-in + key for the hosted branch, bounds raw body at 32 KiB, prompt at 4,000 characters, IDs at 160, and source image description at 4,000. Non-AI draft authoring never guesses answers and still needs review; no real drafts were created by testing.
- Local source-only Tutor remains usable without a paid call or usage-table dependency.

Evidence: `src/features/ai/queries.ts:67-112`; Tutor route reservation at 192-204; Practical reservation at 116-130. Existing flashcard/case/evaluation routes already reserve before `generateJson`; they now inherit the fail-closed helper.

## 14. Concurrent/retry bypass protection

PASS: the real quota helper with a serialized deterministic DB double lets exactly one of ten requests win at usage 14, ending at 15; nine reject. Actual Tutor route concurrency regression also results in exactly one mocked provider call and nine 429s. The advisory lock spans the counter read and write inside one transaction; process-local read-then-charge is not used. Different endpoints use the same lock/key/bucket and authenticated user ID.

These are deterministic tests, not a production load test or a write to the recovered DB. There is no new provider-wide semaphore/global monetary circuit breaker/monthly bill ceiling. A finite per-user daily operation budget also bounds same-day simultaneous starts by remaining slots, but is not a separate lower concurrency/RPM cap. Cairo-day rollover, many accounts, provider pricing and token consumption still require broader P2 cost controls.

## 15. Subscriber behavior

Subscribers and Admin reserve just like other actors. An entitled subscriber with exhausted quota gets 429 without an external call. The former "activate Premium for unlimited chat" error text was removed. Role/subscription/client state cannot choose a larger quota or a different quota owner. Existing content entitlement behavior and release policy remain unchanged.

## 16. External-call-before-auth checks / alternate paths

PASS: anonymous and denied Tutor entry requests never reach retrieval/reservation/provider/generated-content persistence. Denied PDF requests never reach storage. Quota rejection/errors prevent hosted calls. All five exposed AI route call sites were rechecked:

| Route | Reservation before hosted provider | Notes |
|---|---|---|
| `/api/tutor/chat` | YES, all actors | Each context source separately authorized |
| `/api/review/flashcards` | YES, existing + fail-closed helper | Full lecture access; existing idempotency/source/token limits |
| `/api/review/cases` | YES, existing + fail-closed helper | Full lecture access; existing idempotency/source/token limits |
| `/api/review/cases/evaluate` | YES, existing + fail-closed helper | Owned current-access case; local evaluation when provider unavailable |
| `/api/practical/generate` | YES, moved before call | Opt-in, bounded input; unrelated source lookup blocker retained |

No exposed additional hosted summary/mind-map/MCQ/weekly-plan route was found in the audit or targeted call-site search. Operator generation scripts are not student HTTP endpoints. Existing fixed provider/model, 30/60-second timeout and 2,048/4,096-output-token ceilings remain.

## 17–19. Database counts before / after

| Entity | Before | After |
|---|---:|---:|
| Modules | 44 | 44 |
| Lectures | 394 | 394 |
| Questions | 740 | 740 |

SELECT-only verification inside READ ONLY transactions. Repeated module/lecture/academic-period fingerprints stayed `fc8b63113c525326f6e92b02d309e3be`, `5fc7d6b1fa1963d086251c501ccf46b1`, `e29b20ab8e8a68fb9df2f5ba28f983f8` respectively. AI counter rows stayed 2; Practical images/questions stayed 11/15; OSPE keys/associations stayed 759/0. Year-1 mappings remain 10; Years 2–5 remain unmapped. No guessed periods/dates or curriculum/PDF edits.

## 20. Tests added

64 additional tests relative to the 972-test baseline:

- `src/features/access/p0-content-security.test.ts`: actual PDF/Tutor routes with real central authorization/release/period policy; server actor/entitlement/preview, copied URL, source filtering, subscriber exhaustion, fail-closed errors, parallel calls, local mode and input limits.
- `src/features/ai/quota-fail-closed.test.ts`: missing relation, DB error, malformed counters, unconfirmed increment and invalid/uncapped limit rejection.
- `src/shared/storage.test.ts`: both drivers, streaming contract, path containment and retained static proxy denial.
- `src/shared/bounded-json.test.ts`: ordinary/invalid JSON, early Content-Length denial, false small length, multibyte bytes and cancelled chunked oversize.
- `src/app/api/practical/generate/route.test.ts`: three added cost-safety regressions; two old success-only charge assertions updated to the deliberately safer pre-call reservation/failure-retention semantics. Existing draft/review/answer/track/idempotency behavior tests retained.

## 21–25. Quality gates and security regressions

| Gate | Actual result |
|---|---|
| Focused security + generation regressions | PASS, 121 tests / 10 files |
| `npm test` | PASS, **1036 tests / 81 files** |
| `npm run typecheck` | PASS, run after build-generated types |
| `npm run lint` | PASS, **0 errors / 197 existing warnings**, unchanged count |
| `npm run build` | PASS, 79 pages generated, nine pre-existing filesystem tracing warnings |
| `git diff --check` | PASS; ordinary existing LF/CRLF conversion notices only |

No real provider calls, email, load test, migrations, seeds or data writes. All external AI and DB writes in tests are mocked.

## 26. Browser/runtime QA

- Browser inventory worked but had **no existing tabs/authenticated Student or Admin sessions**. Authenticated browser lecture/PDF/Tutor/exhaustion and Admin access: **NOT VERIFIED**, not a claimed visual PASS. No credentials were guessed, collected or changed, and no account/subscription/quota was manufactured.
- Local runtime HTTP checks: `/api/health` 200 with DB healthy; anonymous PDF 401 with private/no-store; anonymous Tutor POST 401; `/admin` 307 to `/sign-in`.
- Role/entitlement/hidden-context/admin/exhaustion behavior is tested at actual route level with real policy and mocked IO. Hosted provider remains uncalled. A legitimate isolated two-user production-mode/CDN check is still required before external rollout.

## 27–29. Remaining findings / P0 items

- Confirmed CRITICAL: none demonstrated by the audit; this is not a security guarantee.
- Targeted confirmed HIGH code paths SEC-001/002/003 are remediated. **SEC-001 deployment completion remains pending CDN bypass/old-cache purge verification and authenticated runtime QA.** Do not equate origin unit tests with a CDN rollout.
- Dormant HIGH SEC-009 Paymob fail-open HMAC remains untouched; checkout/webhook/redeem activation must remain disabled.
- Remaining P0 before external testers: owner-approved isolated HTTPS production-mode environment, no publicly exposed dev DB/server or shared-password fixture deployment, and legitimate authenticated role/IDOR plus controlled session/recovery tests. No accounts were automatically removed/reset.
- P1 remains: legacy unreviewed OSPE SEC-004, saved derivative retention SEC-005, CSV SEC-006, recovery/auth rate limits SEC-007/008, error leakage SEC-012, reviewed dependency upgrades and Docker/HTTPS/artifact issues. These are not fixed in this scoped task.
- P2 remains: global/provider budget, lower concurrency/RPM caps, accurate Tutor token accounting (existing zero-token records unchanged), monthly limits and shared production throttles. A 15-operation budget is not a currency-cost certification.
- SEC-010: quota ordering/ignored result and hosted/input protections fixed; underlying module ID passed to slug resolver remains blocked, and authoring access/source policy still requires separate review. No Practical feature was enabled or expanded.

## 30. Additional observations, not expanded into fixes

Case evaluation currently gates hosted usage on provider-key presence rather than the same `USE_HOSTED_AI` opt-in used by Tutor/cards/cases generation. It still authenticates, owner/entitlement-checks and atomically reserves before calling the provider, so this is **not an alternate quota bypass**. No evaluation was run against the actual key. Consistent opt-in policy can be reviewed separately; this task does not claim opt-out disables every AI route.

No independent curriculum publication field exists, and actual CDN/S3 policies were unavailable for verification. These limitations are disclosed, not masked by adding frontend checks or guessing publication state.

## 31. Exact remediation files

1. `src/app/api/content/pdf/[lectureId]/route.ts`
2. `src/shared/storage.ts`
3. `src/app/api/tutor/chat/route.ts`
4. `src/features/ai/queries.ts`
5. `src/app/api/practical/generate/route.ts`
6. `src/features/practical/http.ts`
7. `src/shared/bounded-json.ts`
8. `src/features/access/p0-content-security.test.ts`
9. `src/features/ai/quota-fail-closed.test.ts`
10. `src/shared/storage.test.ts`
11. `src/shared/bounded-json.test.ts`
12. `src/app/api/practical/generate/route.test.ts`
13. `SECURITY_REMEDIATION_P0.md`

`SECURITY_AUDIT.md` remains the unchanged local source report and is intentionally not staged with the remediation.

## 32. Database/schema changes

**NONE.** The existing daily counter table and transaction/advisory lock support finite atomic enforcement; no new table/index/migration is necessary. No prices, subscriptions, passwords, roles, approvals, mappings, PDFs or curriculum records were changed. Future legitimate hosted use will increment existing usage tables normally; this task performed no real hosted invocation.

## 33. Unrelated WIP preserved

A before/after SHA-256 comparison of existing tracked and nonignored files (excluding `tmp/`) found changes only in the seven existing remediation targets listed above. All other 1,001 existing files, including the audit and unrelated WIP, matched their baseline. New files are only the six explicitly listed remediation/report artifacts. No reset, clean, bulk stage, force-push or switch to main.

## 34. Commit

Focused commit containing this report: `fix: close critical content and AI access gaps`. Its actual hash is returned in the final delivery and obtainable with `git log -1 --oneline`; embedding a commit's own hash in its versioned report would be self-referential. Stage only the 13 exact files above after all gates pass.

## 35. Push

Normal push to the existing `wip/renal-anatomy-practical` branch only, after commit/gate verification. The actual push result and remote/HEAD equality are reported in the final delivery. No PR/main merge is authorized or performed.

## Final verdict

- **Three targeted findings:** vulnerable origin/code paths closed and original behaviors denied in deterministic actual-route regressions. Deployment-level cache completion and authenticated browser QA remain explicitly unverified.
- **External student testing from these findings alone:** conditionally acceptable only after deploying this commit, ensuring CDN bypass/purge where necessary, and verifying legitimate authenticated Student/Admin flows in an isolated environment. Not a blanket launch approval.
- **Remaining blocker before external testers:** safe HTTPS production-mode/dataset setup, shared fixture-account policy, real role/IDOR checks, actual CDN/static/S3 boundary verification. Keep unreviewed OSPE blocked before its term opens.
- **Before real payments:** separate fail-closed HMAC, trusted amount/currency/order/status reconciliation, transaction/idempotency/replay/entitlement tests and owner approval; payments remain disabled.
- **Before public launch:** resolve the remaining P0/P1 audit findings and production/dependency/deployment issues; verify browser, cookies/TLS, recovery controls and multi-user isolation. No claim of 100% security.

STOP after this scoped remediation/checkpoint. Do not start payment fixes or unrelated hardening.
