# VYLO — External Tester Readiness

Verified: 2026-10-03 02:27 UTC / 05:27 Africa/Cairo.

Project: `C:\work\projects\platform`  
Branch: `wip/renal-anatomy-practical`  
Starting and ending HEAD: `13e68fd01115f90bf4f754fb3bc4d2d4618f7585`.

## Verdict

**C. NOT READY** for invited external student testing yet.

The scoped P0 PDF, Tutor-context and hosted-quota regressions pass. The owner explicitly confirmed that VYLO has **not been deployed externally**. External stale-cache removal is therefore **NOT APPLICABLE — no external shared cache exists yet**, not an outstanding purge action.

Readiness is still blocked by unavailable authenticated Student/Admin browser QA and by the previously documented SEC-005 saved-derivative access gap in the current working tree. `/flashcards/all` and `/cases/all` require ownership but do not recheck current lecture entitlement/release before displaying saved content. This is conditional on previously saved data; it is not evidence of cross-user access. An owner-only library is not equivalent to current curriculum authorization. Under this task's safety criteria this remains an entitlement/release blocker. It was not changed because unrelated audit findings are outside this task.

A safe HTTPS, production-mode invited-test deployment also remains unverified. Do not expose the current development server or deploy the existing shared-password test-user dataset. This verdict does not approve real payments or public launch.

## Verification boundaries

- Read `SECURITY_REMEDIATION_P0.md` first and consulted relevant `SECURITY_AUDIT.md` findings; inspected current implementations, not just report claims.
- Real local HTTP checks ran against `http://localhost:3000`. `/api/health` returned 200 with `ok=true, db=true` before and after gates.
- Browser surface inventory contained no tabs and therefore no available authenticated Student or Admin session. No credentials were requested; no account/session was created, copied or changed.
- Authenticated PDF, hidden-year, Admin, Tutor and cross-account results below are **deterministic tests with mocked IO/session/provider**, using the real central release/period/entitlement helpers and route implementations. They are **not authenticated browser or deployed-cache verification**.
- PostgreSQL inspection used explicit `READ ONLY` transactions and SELECTs. No migrations, seeds, resets, subscription grants, station mapping writes or paid AI calls were executed.
- The full working tree was verified, including existing uncommitted/untracked WIP. Passing gates are not a claim that HEAD alone contains that WIP or that any deployment has it.

## Actual file delivery architecture

### Local configuration and runtime

Protected lecture PDFs use `/api/content/pdf/[lectureId]` -> trusted `getSession()` -> `getAccessibleLecture(..., { allowPreview: true })` -> `streamFile()`.

`src/shared/storage.ts` selects local storage by default and resolves paths inside the content root, outside the app's public directory. Local environment-file resolution selects `local`; S3 endpoint/bucket/credentials are absent. Environment-file resolution is **not proof of all environment values in the already-running process**. Unauthenticated runtime denials and health were verified; an actual authenticated PDF stream was not.

The lecture handler is `force-dynamic` and applies protected headers to both handled denials and successful storage responses, overriding a storage response's public cache defaults. Local and S3 storage streaming defaults are private/no-store.

The other current PDF handler is `/api/content/ospe/pdf?file=...`. It requires authentication, an allowlisted reference and `getAccessibleOspeFolder()`; successful streams use private/no-store. Its 401 response does not include the lecture route's explicit cache headers. A missing cache header on that denial is not evidence of publicly cached PDF bytes.

All seven PDFs under `public/` are in `public/ospe-pdfs/`. `src/proxy.ts` blocks `/ospe-pdfs/*` and `/study-cards/*` before direct static serving. The 248 generated SVG study cards also use protected routes. No additional PDF-serving route was found in the inspected API code. `getPublicUrl()` has an optional direct-S3 URL branch but no current call sites; it is not a demonstrated public bucket exposure.

Observed listeners: Next.js on `0.0.0.0:3000` / `[::]:3000`; PostgreSQL on `127.0.0.1:5432`. An all-interface listener does not prove internet exposure, but this development server must not be exposed to external testers.

### Intended deployment, not an existing deployment

`Dockerfile`, `docker-compose.staging.yml` and `.github/workflows/deploy-staging.yml` describe a single-VPS Docker/Next.js deployment with a read-only content mount and persistent internal PostgreSQL. S3 is an optional storage driver. No configured nginx, Cloudflare, Vercel, CDN, reverse-proxy cache or TLS termination was found in the reviewed configuration; no `.vercel/project.json` is present.

The owner confirmed no external deployment exists. Neither future proxy behavior nor future S3 bucket privacy is verified. The existing audit's Docker final-stage/standalone packaging and HTTPS/cookie deployment issues remain separate deployment prerequisites. The staging workflow can run historical migration/seed services: **do not run it merely to perform this verification**. No Docker deployment, workflow or migration service was launched.

If a future proxy/CDN is added, preserve authentication-dependent origin headers and bypass shared caching for protected content routes. If object storage is selected, verify private object/bucket access and ensure content is delivered through authorized handlers. There is no purge to perform now.

## Local HTTP evidence

| Request/check | Actual result |
| --- | --- |
| `/api/health`, before and after gates | 200; database connected |
| `/admin`, anonymous | 307 to `/sign-in` |
| Same real lecture PDF API URL twice, anonymous | 401 twice; generic `unauthorized` JSON |
| `/api/tutor/chat`, anonymous POST | 401; generic `unauthorized`; no paid provider call |
| OSPE reference PDF API, anonymous | 401; generic `unauthorized` |
| Known `/ospe-pdfs/{file}` | 404 |
| Known `/ospe%2Dpdfs/{file}` | 404 |
| `/public/ospe-pdfs/{file}` | 404 |
| Known `/study-cards/{file}` | 404 |
| Stored lecture PDF relative path requested directly | 404 |
| Same path under `/public/` | 404 |

Real lecture-PDF denial headers:

```text
Cache-Control: private, no-store
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
Vary: rsc, next-router-state-tree, next-router-prefetch,
      next-router-segment-prefetch, Cookie, Authorization
Age: absent
CF-Cache-Status: absent
X-Cache: absent
Via: absent
```

Next.js augments `Vary` without removing Cookie/Authorization or overriding the protected cache policy on these observed denials. Authorized 200 headers were verified at route-test level, including an intentionally public-cacheable mocked storage response. **Authorized 200 headers across the real running framework remain NOT VERIFIED.** No authorized-user cache priming experiment was performed.

API denials inspected were generic and contained no secret, filesystem path, SQL error, filename, hidden title or stack trace. This is not a blanket audit of every HTML/error response or future deployment. Static 404 response bodies were discarded; no PDFs were downloaded or modified.

## Required results

| # | Item | Result and evidence |
| --- | --- | --- |
| 1 | Starting HEAD | `13e68fd01115f90bf4f754fb3bc4d2d4618f7585`, current WIP branch. |
| 2 | Actual protected-file delivery architecture | Local Next.js authorized handlers + configured local filesystem; intended VPS Docker/Next.js + optional S3. See architecture above. |
| 3 | CDN/shared cache present | **NO** external deployment/cache, per owner. None observed in local HTTP/configuration. |
| 4 | Protected PDF Cache-Control verified | **PASS** real anonymous 401 and deterministic authorized 200: private/no-store. Real authenticated 200: **NOT VERIFIED**. |
| 5 | CDN/proxy override detected | **NO** on observed local denials; Next.js adds RSC Vary entries only. Authenticated runtime/future deployment: **NOT VERIFIED**. |
| 6 | Stale protected cache risk | External risk **NOT APPLICABLE** before first deployment; old local browser caches were not inspected. |
| 7 | Cache purge | **NOT APPLICABLE — no external shared cache exists yet**. No purge/provider action performed or invented. |
| 8 | Alternate/public PDF path found | **NO** in inspected handlers/public inventory and tested known paths. This is not exhaustive URL fuzzing or a future S3 ACL check. |
| 9 | Anonymous PDF access | **PASS** live 401 twice before content delivery; no-store and generic denial. |
| 10 | Unauthorized Student PDF | **PASS, deterministic tests**: non-disclosing 404 before storage for unentitled paid content and revoked access. Real Student session: **NOT VERIFIED**. |
| 11 | Authorized Student PDF | **PASS, deterministic tests**: entitled/valid-preview 200, protected headers. Real authenticated stream: **NOT VERIFIED**. |
| 12 | Hidden-year PDF | **PASS, deterministic tests**: Years 3–5, unmapped Year 2, future term and inactive Summer denied despite entitlement/free-preview. Real hidden-year request: **NOT VERIFIED**; Years 3–5 currently have no lectures. |
| 13 | Cross-account protected URL | **PASS, deterministic server-session tests**: same URL A=200, B=404, anonymous=401; storage called once. Live two-account/cache test: **NOT VERIFIED**. |
| 14 | Student authenticated browser QA | **NOT VERIFIED** — no existing authenticated browser session/tab available. |
| 15 | Admin authenticated browser QA | **NOT VERIFIED** — no existing authenticated browser session/tab available. Anonymous Admin redirect verified, not Admin usability. |
| 16 | Year 1 student result | Central active-period/entitlement/preview tests pass. DB: 10 modules/248 lectures, all 10 modules mapped. Current period is Term 1; future Term 2/Summer denied in tests. Dashboard/Modules/lecture UI: **NOT VERIFIED**. |
| 17 | Year 2 student result | DB: 8 modules/146 lectures, 0 mapped. Existing fail-safe denies unmapped modules; test passes. No Year-2 period created. Browser: **NOT VERIFIED**. |
| 18 | Years 3–5 student result | Real policy tests deny each even when entitled/free. DB: 9/7/10 modules respectively, all unmapped, no lectures. Student list/direct UI: **NOT VERIFIED**. |
| 19 | Years 1–5 Admin result | Real helper tests retain Admin bypass, including hidden-year lectures/PDFs; 44 modules confirmed in DB. Admin navigation/count/content/period management browser QA: **NOT VERIFIED**. |
| 20 | Tutor authorized context | **PASS, deterministic tests**: visible preview/entitled source works; DB metadata is authoritative; source-only mode retained. No real paid response requested. |
| 21 | Tutor hidden context | **PASS, deterministic tests**: inaccessible paid sources, Years 3–5, unmapped Year 2, future term, inactive Summer and foreign/deleted candidates excluded from prompt/source metadata; denied entries return generic 404 before AI/quota/writes. No independent general lecture-publication flag exists to verify. |
| 22 | AI quota | **PASS** shared hosted `study_generation` limit = 15/user/Cairo day; anonymous denied, under-limit allowed, exhausted 429, failed quota 503. Client user/role/subscription claims ignored. Local non-hosted work is not charged this hosted quota. |
| 23 | Subscriber quota | **PASS, deterministic tests**: subscription permits content, not unreserved/unlimited hosted operations; exhausted subscriber denied. |
| 24 | Admin quota | **PASS, deterministic tests**: Admin keeps content access but also reserves hosted budget; exhausted Admin denied. |
| 25 | Parallel quota protection | **PASS, deterministic tests + code inspection**: transaction/advisory-lock reservation; at count 14, ten mocked parallel Tutor requests yield one provider call and nine denials. No live PostgreSQL load/concurrency test or paid load performed. |
| 26 | New console/runtime errors | No unexpected 5xx in safe local HTTP probes; full gates pass. Authenticated console/network, loops and real PDF/Tutor rendering: **NOT VERIFIED**, not claimed error-free. |
| 27 | Desktop QA | **NOT VERIFIED** for authenticated Student/Admin at ~1440px; no sessions. |
| 28 | Mobile QA | **NOT VERIFIED** for authenticated Student/Admin at ~375px; no sessions. |
| 29 | Modules before/after | **44 / 44**. |
| 30 | Lectures before/after | **394 / 394**. |
| 31 | Questions before/after | **740 / 740**. |
| 32 | Focused security tests | **121 passed / 10 files** in a separate focused run. Included within full count, not 121 additional unique tests. |
| 33 | Total tests | **1036 passed / 81 files**; full `npm test`. |
| 34 | Typecheck | **PASS**, `npm run typecheck`, after build. |
| 35 | Lint | **PASS**, `npm run lint`: 0 errors, 197 existing warnings; warnings untouched. |
| 36 | Build | **PASS**, `npm run build`: 79/79 generated pages, 9 existing dynamic-filesystem tracing warnings. Docker packaging was not built/deployed. |
| 37 | Files changed by this task | **Only `EXTERNAL_TESTER_READINESS.md`**. No product code fix needed in scoped P0 checks. Existing WIP preserved. Ignored build/typecheck artifacts generated by requested gates. |
| 38 | Database/schema changes | **NONE**. SELECT-only integrity queries; no account, content, billing, mappings, station approval, schema or PDF changes. |
| 39 | Commit | **NONE**; HEAD unchanged. Task forbids a new commit when no code remediation is required. |
| 40 | Push | **NOT PERFORMED**; no remediation commit. No merge, staging or deployment performed. |
| 41 | Before invited external student testing | Resolve known SEC-005 current-access gap under owner-approved retention policy; complete legitimate Student/Admin and two-account runtime QA; prepare isolated HTTPS production-mode deployment without shared fixture credentials. Preserve no-store/static protection and verify any selected storage/proxy boundary at deployment. |
| 42 | Before real payments | Payments remain off. Separate fail-closed Paymob HMAC, trusted order/amount/currency/status reconciliation, transactional/idempotent/replay-safe entitlement tests and owner approval are required. No payment/webhook/real transaction was exercised. |
| 43 | Before public launch | Resolve remaining security-audit P0/P1 items, including legacy unreviewed OSPE before its term opens, saved-derivative policy, recovery/auth rate limits, CSV/error leakage, dependency review and Docker/HTTPS/artifact deployment issues; verify real browser/cookie/session isolation, availability and operational controls. No production-readiness or complete-security claim. |

## Focused regression commands

```text
npm test
npm run lint
npm run build
npm run typecheck
npm test -- src/features/access/p0-content-security.test.ts src/features/ai/ai-quota.test.ts src/features/ai/quota-fail-closed.test.ts src/shared/storage.test.ts src/shared/bounded-json.test.ts src/app/api/practical/generate/route.test.ts src/app/api/review/flashcards/route.test.ts src/app/api/review/cases/route.test.ts src/app/api/review/cases/evaluate/route.test.ts src/features/access/student-release-access.test.ts
```

All passed with the stated counts. The Vite native-config-loader warning is informational and unchanged; no warning-cleanup task was started.

Quota evidence: `src/features/ai/queries.ts` (`FREE_DAILY_LIMIT`, `reserveAiUsageSlot`), `src/features/ai/ai-quota.test.ts`, `src/features/ai/quota-fail-closed.test.ts`, and hosted route tests. Missing table/DB failure, invalid counters/limits and unconfirmed increments fail closed without the legacy unlimited fallback. Failed provider calls retain a reservation. This is a daily operation limit, not a global monthly cost ceiling, per-minute limiter or live concurrency capacity certification. Case evaluation's existing provider-key behavior can still select hosted evaluation despite the global generation opt-in being false, but ownership/access and the shared reservation remain enforced; no evaluation was invoked and no alternate unlimited path was found in these regressions.

Practical generation's previously documented image-module ID/slug mismatch remains a functional blocker, not an authorization bypass; the existing 15 practical questions are DRAFT_AI (10 fixtures, 5 non-fixtures), with no APPROVED questions. No station content was enabled to perform this task. The 759 OSPE answer keys and zero track associations are unchanged; keep legacy unreviewed OSPE inaccessible before future term availability.

## Integrity and preserved work

Read-only before/after module, lecture and academic-period fingerprints match:

| Entity | Fingerprint before = after |
| --- | --- |
| module | `fc8b63113c525326f6e92b02d309e3be` |
| lecture | `5fc7d6b1fa1963d086251c501ccf46b1` |
| academic_period | `e29b20ab8e8a68fb9df2f5ba28f983f8` |

Before/after all 1014 existing Git-listed tracked/nonignored-untracked files outside `tmp/` match SHA-256 `e1472bde39d044d789c98eaab8d411929a043e38b8950a53ae05c3a7787af8dd` (the new report is excluded). Existing 26 tracked modifications and all unrelated untracked WIP remain untouched. This source check excludes ignored output/temporary files and is not a filesystem-wide immutability claim. No files were staged.

## Safe closure actions, not executed

1. Owner-approved separate SEC-005 remediation: decide derivative retention policy and recheck current lecture access on every library display path; add revoked/hidden-source regression tests. Do not change ownership or grant subscriptions to make checks pass.
2. With legitimate existing sessions available, verify Student/Admin desktop/mobile and actual authorized PDF headers; repeat the same protected URL across permitted and denied accounts without exposing cookies. Complete real console/network checks. Mocked PASS must not be promoted to browser PASS.
3. Prepare an owner-approved HTTPS production-mode invited-test environment with safe account/dataset/storage policy; resolve known Docker/standalone packaging issues before using that deployment configuration. Do not expose `next dev`, the local database, or shared-password fixture accounts.
4. Verify the selected deployment's protected-file paths, proxy cache behavior and any S3 ACLs. No stale external cache exists to purge now. Keep payments disabled and unreviewed OSPE blocked.

No unrelated implementation was started. STOP.
