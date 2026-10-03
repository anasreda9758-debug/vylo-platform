# VYLO Security & Access-Control Audit

Audit date: 2026-10-03. Evidence collected approximately 01:33-01:56 UTC (04:33-04:56 Africa/Cairo), including the final integrity check.

Mode: READ ONLY. This is an audit of the current checkout, including existing uncommitted work, not a certification of a deployed production system. No repairs were implemented.

## 1. Starting HEAD

- Project: `C:\work\projects\platform`.
- Branch: `wip/renal-anatomy-practical`.
- Starting and finishing HEAD: `ce0403ab532cf982cc6ef41038c4083743821f44` (`ce0403a`).
- The checkout already contained 26 modified tracked files and substantial untracked WIP. Those changes were preserved.
- A combined SHA-256 over 1,007 existing tracked/non-ignored files, excluding `tmp/`, was unchanged before and after report creation: `39b0d3588dac3eea01f7da97ba1eca298b54f3a3a6064a4386f3ce706076cd11`. The new report is excluded from this comparison.

## 2. Audit scope and evidence limits

Inspected all 59 API route files, central authorization, sensitive page/data flows, authentication and the installed Better Auth implementation, curriculum visibility, billing, file delivery, Practical/OSPE, the five reachable AI-powered API features, relevant schemas/queries/tests, package/lockfile, secret patterns, reachable Git history, Docker and production configuration.

Verification used the existing full quality gates, SELECT-only queries inside PostgreSQL `READ ONLY` transactions, file metadata checks, 14 unauthenticated local GET requests, and in-memory tests of actual transpiled source with mocked authentication, database and AI dependencies. No authenticated session was created: signing in or refreshing a session can write to the DB. Authenticated browser IDOR testing was therefore NOT performed in this strictly read-only audit. Existing tests and isolated proofs are not equivalent to a live multi-user production test.

Not tested: actual CDN configuration/cache behavior, production TLS/firewall, S3 bucket policy, production users/secrets, real Paymob transactions, provider billing, load/concurrency attacks, malicious uploads or stolen-session replay. No application source, configuration, original PDF, account, subscription or mapping was changed. The explicitly requested report is the sole intentional new artifact; normal gate outputs under ignored build/temp locations are not product changes.

### Current database/content evidence

The correct local `lms` database was reachable. Counts and curriculum fingerprints were identical on repeat checks:

| Entity | Actual count |
|---|---:|
| Modules | 44 |
| Lectures | 394 |
| Questions | 740 |
| Academic periods | 3 |
| Lectures with nonempty source text | 248 |
| Lectures with PDF | 248 |
| Distinct lecture PDF files | 248 |
| PDF lectures with invalid/missing page bounds | 0 |
| OSPE answer keys/station definitions | 759 |
| Reviewed Practical-to-OSPE station associations | 0 |
| Practical tracks | 1 |
| Practical images | 11 |
| Practical questions | 15 |
| Practical questions: development fixtures / DRAFT_AI | 10 |
| Practical questions: real / DRAFT_AI | 5 |
| Practical questions: REVIEWED / APPROVED | 0 / 0 |
| OSPE referenced image files present / missing | 529 / 230 |
| AI daily-counter rows | 2 |

| Study year | Modules | Lectures | Mapped modules |
|---|---:|---:|---:|
| 1 | 10 | 248 | 10 |
| 2 | 8 | 146 | 0 |
| 3 | 9 | 0 | 0 |
| 4 | 7 | 0 | 0 |
| 5 | 10 | 0 | 0 |

Fingerprints, calculated by `md5(string_agg(to_jsonb(t)::text, '' ORDER BY id))`:

- Module: `fc8b63113c525326f6e92b02d309e3be`.
- Lecture: `5fc7d6b1fa1963d086251c501ccf46b1`.
- Academic period: `e29b20ab8e8a68fb9df2f5ba28f983f8`.

These also match the existing student-release QA report. No missing-data recovery was attempted. Years 3-5 currently contain no lectures: their direct lecture protection is supported by real-helper tests with synthetic test fixtures, not nonexistent live lecture IDs.

## 3. Authentication architecture found

Better Auth runtime is **1.6.29**, using the Drizzle PostgreSQL adapter. Email/password registration defaults to student, auto-sign-in is disabled, and email verification is required. Email OTPs have six digits, a ten-minute lifetime, five allowed attempts, hashed storage and rotation. Resend delivery is awaited; missing configuration and non-2xx responses throw. No verification email was sent during this audit.

Evidence: `src/shared/auth.ts:87-146`, `src/shared/session.ts`, `src/app/api/auth/[...all]/route.ts`, `src/features/auth/password-recovery.ts` and installed `node_modules/better-auth/dist/api/routes/{sign-in,session,sign-out,password}.mjs`.

- Password hashing uses salted scrypt, not plaintext: installed `@better-auth/utils/dist/password.node.mjs` uses N=16384, r=16, p=1, 64-byte output and random salt. Its final comparison uses ordinary equality; constant-time comparison is a hardening recommendation, not a demonstrated password bypass.
- Sessions are server-backed, signed-cookie validated, expire after seven days, and renew on a one-day update schedule. Session cookie caching is not enabled by the project configuration. Sign-in creates a fresh session; sign-out uses Better Auth invalidation. Reset tokens are consumed by Better Auth; successful password reset revokes sessions.
- Cookies are HttpOnly, SameSite=Lax, Secure in production. Local HTTP development uses non-Secure cookies deliberately. Secure production cookies require HTTPS; the HTTP staging default is not a safe production setup.
- Trusted origins are exact HTTP(S) origins; wildcard origins are rejected. Better Auth origin/CSRF checks have not been disabled. Password-reset callback URLs use the installed library's origin validation.
- Role is a non-client-writable additional field (`input:false`, default student). Installed input parsing replaces the role with its default on creation or rejects disallowed updates; profile mutation allowlists name only.
- Custom password recovery uses high-entropy challenge/reset capabilities, hashed codes, expiry, a bounded atomic attempt increment and a one-time claim. Its per-email cooldown does not provide a global abuse budget; see SEC-007.
- The intended auth `rateLimit` configuration is misplaced under `advanced`; see SEC-008. Do not describe production authentication as entirely unthrottled: Better Auth's defaults still apply.
- `emailVerification.sendOnSignIn` is also nested under `emailAndPassword`, while the installed sign-in implementation reads the top-level option. This can impair automatic resend UX, but the unverified-login denial remains enforced. The explicit OTP flow is separate; no verification bypass was found.

No realistic admin takeover, authentication bypass or session fixation was demonstrated. A stolen valid session remains usable until revocation/expiry, as with ordinary bearer sessions; replay was not attempted.

## 4. Authorization architecture found

`src/features/access/learning-access.ts` centralizes trusted actor, academic visibility, entitlement and ownership checks. `canAccessModule` evaluates release/period visibility before paid/free access, with an explicit admin bypass. `getAccessibleLecture` allows only the first ordered lecture as a free preview when requested. Cards/cases generation explicitly disables that preview exception.

Module/lecture/question relationships come from server-side DB records, not client-supplied ownership or subscription state. Quiz attempts, review records, flashcards, cases and OSPE exams are owner-bound. Practical resolves the authoritative module + subject track, filters approval/fixture eligibility, strips answer fields, and persists before returning feedback.

The central helpers are generally sound. The important failures are alternate paths not using the same safeguards: Tutor RAG chunks (SEC-002), legacy OSPE (SEC-004), and saved-card/case pages (SEC-005).

## 5. Admin protection result

PROTECTED in inspected code and relevant tests. Both `/admin` and `/admin/practical` call `requireAdmin` on the server. All 13 admin API files check server-side admin role before data access/mutation; this does not depend on hidden buttons. Some return 403 for both missing/non-admin sessions, while others distinguish 401/403; neither grants access.

Local unauthenticated evidence: `/admin` -> 307 `/sign-in`; `/api/admin/modules` -> 403; `/api/admin/analytics` and `/api/admin/practical-authoring` -> 401. Existing admin analytics tests cover unauthenticated denial, student denial, multiple views, and authorized admins.

Admin retention of all study years is explicit in the central visibility helper and tested. An authenticated admin browser session was not exercised in this audit. Admin CSV exports have a separate user-controlled formula issue (SEC-006); it is not an admin API authorization bypass.

## 6. Student curriculum protection result

Generally PROTECTED through `academic-curriculum.ts`, `academic-visibility-server.ts`, and central learning access. Search checks each retrieved lecture after global index retrieval, before returning its title/snippet. Selectors, module pages, lecture pages, weekly planning, review/quiz analytics and Practical use current server policy.

The policy remains `[1,2]`; academic-period association is additionally mandatory. Free access, an entitlement or first-lecture preview cannot override an unreleased/future module. Partial result rows carrying only module ID are resolved against the real DB year/period.

Limits: the curriculum module/lecture schemas have no independent publication/private flag. Academic visibility is not a general editorial publication workflow. All rows inserted into an available module are potentially live under the current model; do not put confidential draft lectures there and assume they are hidden. No currently marked private lecture bypass was proven, since that state is not represented.

Some denied paid lecture pages still render their title/subject/module information before the lock panel (`src/app/lecture/[slug]/page.tsx:109-154`). Hidden-year/future-period pages call `notFound()` earlier. Treat paid-title visibility as an owner policy decision, not an automatic severe leak; confidential metadata would require the same non-disclosure behavior as hidden content.

## 7. Year 3-5 protection result

PROTECTED by the centralized release policy independently of URLs, free status and entitlements. Tests include direct module and lecture requests, hidden search metadata, generation denial before quota/AI/write calls, and admin retention. Current DB shows 26 Year-3-5 modules, zero mapped periods and zero lectures. Year 2 has eight modules/146 lectures and intentionally remains unmapped/hidden. No dates or mappings were invented.

Evidence: `src/features/hierarchy/student-curriculum-release.ts`, `student-curriculum-release.test.ts`, `src/features/access/student-release-access.test.ts`, `academic-visibility-server.ts`.

## 8. Future-term and Summer protection result

PROTECTED in the shared policy and tests: exact Cairo start/end boundaries, DST, inactive/missing configuration, future terms, overlapping ordinary/Summer periods, and hidden Summer after its end. Regular terms remain historically visible after they start; Summer is available only within its active window and not during an overlapping ordinary term. This distinction is intentional.

Only one regular period has started locally. All 759 existing legacy OSPE answer keys belong to the four Year-1 Term-2 folders (CVS 356, IBL 109, RENAL 243, RESP 51); none lies in a currently started regular term. Therefore the legacy OSPE defect is currently shielded from ordinary students by academic dates, but becomes reachable with valid module access once those terms open. Dates must not be relied on to replace station approval.

## 9. Subscription/entitlement protection result

Generally PROTECTED: `src/features/billing/queries.ts:136-180` derives access from trusted subscription scope/status/start/expiry/grace and Summer access. Central learning authorization performs academic policy first. Admin bypass is intentional and role-bound. Arbitrary client user/module/subscription IDs cannot manufacture an entitlement.

Quiz answer/finish/bookmark/review routes verify real bank, question, option and owner relationships; correctness is read from the DB, not supplied by the client. Cards/cases creation and evaluation require the appropriate lecture/case access. Notes are owner-bound and lecture access is checked on read/create. Deletion can remove only the owner's note.

Exceptions: saved derivative pages omit renewed authorization (SEC-005); Tutor preview context omits per-source checks (SEC-002); protected PDF responses advertise shared caching (SEC-001). No live subscription or account was altered to test revocation.

## 10. PDF/file protection result

- API PDF access authenticates and checks lecture entitlement/release before `streamFile`; unauthorized direct IDs return 404. Unauthenticated local requests return 401.
- **Confirmed unsafe response cache policy:** both local and S3 PDF streaming use `public, max-age=86400, s-maxage=604800` without Cookie variation (SEC-001).
- The endpoint streams the stored file without applying page bounds. However current data has **248 distinct files for 248 PDF lectures**, and all seven paid-module first-lecture preview PDFs were metadata-checked: each starts at page 1, contains exactly its declared range, and has no extra pages. Shared-book preview disclosure is **not a confirmed current vulnerability**. The route still needs a fail-closed rule for future/unreviewed mappings; see defense-in-depth recommendations.
- `public/` contains seven reference PDFs (~195 MB including its other reference file) and 248 generated SVG cards. `src/proxy.ts` blocks direct `/ospe-pdfs/*` and `/study-cards/*`; real unauthenticated requests to a reference filename/card return 404. API reference PDF serving uses a filename allowlist and module access, with private/no-store caching.
- Practical images live under `private/practical-images`, use normalized/real-path containment and restricted image extensions, require eligible approved questions, and return private/no-store + sandbox CSP headers. Production fixtures fail closed.
- Legacy OSPE images have the separate approval gap in SEC-004; folder/module authorization itself is present.
- In-memory path tests rejected plain traversal outside the image root. Literal encoded traversal remained inside it; decoded request parameters are subject to normalization. No secret files were requested. S3 ACLs, alternate CDN/static origins and Windows filesystem links were not remotely verified.
- `getPublicUrl` has a public-S3 URL branch but no current call sites were found. Do not report that unused helper as a proven live public bucket leak.

## 11. API security result

59 route files were inspected. The complete compact inventory is in Appendix B. Sensitive endpoints have server authentication; admin routes have role checks; resource-specific routes generally have entitlement/release and ownership checks. Public health/pricing-preview/recovery endpoints are intentionally public; disabled webhooks reject all requests. The billing cron authenticates a constant-time Bearer secret and fails closed when absent.

### Mass assignment/input validation

No student-accessible `.set(body)`/`.values(body)` or privileged request-object spread into DB records was found. Role cannot be assigned during signup/profile updates. Profile accepts name only (maximum 200 characters). Most quiz, Practical answer/flag and case-evaluation inputs use bounded Zod schemas. Admin writable fields are allowlisted and privileged updates require admin.

Gaps: legacy OSPE JSON uses TypeScript annotations rather than strict runtime schemas; answer strings/times lack equivalent bounds. Practical generation prompt/IDs and card/case idempotency keys lack consistent maximum lengths. Admin upload checks its decoded 8 MB bound after JSON/base64 allocation. Apply a request-body cap before parsing as well as field limits; this is abuse hardening, not a proven remote execution exploit.

## 12. Payment security result

Current payment processing is intentionally OFF. `/api/billing/purchase` and `/checkout` return 503 after their relevant checks; `/webhook` always returns 503 and cannot mutate payment/subscription state. Redeem confirmation is also explicitly disabled. No active callback/success page was found that grants access. Billing cron changes require its server secret; admin subscription changes require admin.

**Do not enable Paymob on the strength of the current helpers/tests.** `verifyHmac` returns true when its secret is missing, and a test explicitly expects that unsafe behavior (SEC-009). With a secret it uses ordinary string comparison. There is no active, complete audited amount/currency/order/merchant reconciliation, replay/idempotency and status-transition pipeline because live processing is disabled. Dormant code is not a currently exploitable payment-forgery path.

Before accepting money: fail-closed signature verification against official payload fixtures; trusted server amount/currency/integration/order correlation; provider-side verification where required; atomic unique transaction/event handling; monotonic transitions; refund/void/failure checks; entitlement granted only from validated server records. Never grant access from the browser success URL alone.

## 13. AI abuse/cost-control result

| Feature | Authorization | Budget/limits | Result |
|---|---|---|---|
| Tutor | Signed-in + requested lecture (preview allowed) | Non-Premium hosted calls reserve daily quota; 20 messages x 4,000 chars; fixed model; 4,096 output tokens; 60s timeout | Premium bypasses quota; hosted RAG context not individually authorized (SEC-002/003) |
| Flashcards | Full lecture access before generation | Shared 15/day atomic reservation for every user; optional idempotency; source capped at 15,000 chars; 2,048 tokens/30s | Main budget/access controls work; explicit hosted opt-in |
| Clinical cases | Full lecture access; owner-bound results | Same shared reservation/idempotency/source/token/timeout controls | Main budget/access controls work; explicit hosted opt-in |
| Case evaluation | Owned case + current access | Shared reservation before hosted evaluation; bounded answer; fixed model/token/time cap; source-local evaluation when supported | Main ownership/budget controls work |
| Practical generation | Session + source/track/module lookup | Soft quota read before provider; reservation after success; no equivalent prompt max or explicit hosted-opt-in check | Currently blocked by ID/slug mismatch; latent cost race (SEC-010) |
| Summary/mind map/study plan/quiz generation | Existing local derivation or operator scripts | No additional live student AI route found | Do not mistake operator scripts for exposed API endpoints |

Daily reservation uses a transaction and advisory lock in `src/features/ai/queries.ts`; its table is present locally. The missing-table fallback counts legacy successful usage and cannot reserve atomically: do not use that fallback as a production quota guarantee. Stable same-key idempotency prevents duplicate requests where implemented, but changing keys/omitting an optional key permits fresh work within the quota.

No global spend ceiling, monthly budget, provider concurrency semaphore or per-minute generation limiter was found. Premium Tutor has no finite application-enforced daily bound. For N successful requests its configured output ceiling is up to N x 4,096 tokens, plus input tokens; no currency estimate is asserted. Its recorded token values are zero, so current usage logs cannot reliably estimate cost.

Local env-file resolution showed hosted AI opted out and a provider key PRESENT. This is not a full dump of the running process environment. No provider request was made. A later opt-in would expose the Tutor defects; fixing the Practical ID resolution alone would expose its latent budget path.

### Prompt/data security

Prompts include lecture text, retrieval snippets, user messages or owner case/source context. No code was found adding environment secrets, account tables, other users' notes or payment records to prompts. Models have no server-side tools that can retrieve arbitrary URLs or mutate accounts. Instruction injection can influence educational output, but is not by itself server authorization bypass. SEC-002 is a genuine server context-selection flaw: authorization cannot be delegated to a prompt that tells the model not to disclose.

## 14. Rate-limit result

- Auth custom settings are ineffective at their current nesting (SEC-008). Installed Better Auth production defaults are 100/10s globally, 3/10s for sign-in/sign-up/change-password/change-email, and 3/60s for selected recovery/verification endpoints. The OTP plugin declares 1/60s. Development does not enable the default limiter just because the ignored nested setting says enabled.
- Default storage is in-process memory; no shared rate-limit storage is configured. Multi-instance deployments multiply limits. IP headers require a trusted/sanitizing proxy; caller-supplied forwarded headers must not become trusted identity.
- Custom recovery endpoints are outside Better Auth's router. They have email/challenge cooldowns and bounded verification attempts, not aggregate IP/account/global request budgets (SEC-007).
- AI daily quotas are not per-minute/concurrency limits. Premium Tutor bypasses them, and Practical charges late.
- Search, ordinary content/file downloads, notes/profile and other student DB actions have no general application rate limiter. Search input/topK and some result sizes are bounded; the RAG index is cached. These are useful controls but not a complete production resource budget.
- Payment/webhook functions are disabled rather than expensive public paths. Health SELECT is deliberately small. Admin analytics is role-protected and has pagination/timeouts; a `Promise.race` timeout does not cancel the underlying DB query.

## 15. Secret exposure and Git-history result

No production API key or private key was identified by the performed scans. **This is bounded negative evidence, not a guarantee that no secret has ever existed.**

- Scanned 557 current tracked/non-ignored text candidates (including relevant untracked WIP); three files over 2 MiB were skipped in the text scan. Binary assets, ignored actual environment files and `tmp/` were not dumped. Local env presence was checked privately: auth secret PRESENT and at least 32 characters; Resend/provider keys PRESENT. Values were never printed or copied into this report.
- Scanned 132 reachable local Git commits with boundary-aware provider/private-key patterns; zero matching files. A first loose pattern falsely matched schema identifiers; the strict rerun excluded those false positives. Exact `.env`, `.env.local`, `.env.production`, `.env.staging` history checks returned no commits. This does not cover unreachable/dangling Git objects, unavailable remote history, all possible secret formats, or excluded large HTML/lock/binary files.
- Tracked environment files are templates only: `.env.example`, `.env.staging.example`. Known template/CI placeholders are not evidence of production credential exposure. Never deploy template secrets unchanged.
- Committed default local credentials exist: `scripts/dev-db.mjs:19`; test scripts including `scripts/e2e-security.mjs:18,222`, `scripts/e2e.mjs`; admin/test-user defaults at `scripts/seed-admin.ts:8`, `scripts/seed-test-users.ts:14`. Some operator scripts contain default local DB URLs. Actual values are intentionally omitted.
- Current local DB contains a largest group of **100 verified student credential accounts sharing one password hash**. The seed script creates shared-password test users. No hash or password was displayed/validated. Do not expose/copy these accounts into an external testing/production dataset without an owner-approved cleanup/credential plan (SEC-011).
- `scripts/recover-admin.mjs` is existing untracked operator WIP, not an HTTP route. Its known-password literals are an explicit forbidden-password list, not a recovery shortcut; it was not executed.
- `.gitignore` explicitly ignores `.env`, `.env.local`, `.env.production` but not all possible `.env.*` variants. Future staging/development secret files could be accidentally staged. `.dockerignore` excludes `.env*` correctly. Broader secret ignore rules and scanning are hardening recommendations; no files were staged.

## 16. XSS result

No confirmed application DOM/stored/reflected XSS path found. Active Markdown rendering uses ReactMarkdown + remark-gfm without rehype-raw; merely having `rehype-raw` installed does not enable raw HTML. React text output escapes module/lecture titles, notes, search and AI text. No application `dangerouslySetInnerHTML`/raw HTML execution sink was found. Generated study-card SVG strings XML-escape title/labels; current SVG assets were not found to contain script sinks.

This does not certify every future Markdown plugin or imported HTML artifact. Add tests for HTML tags/event attributes, unsafe URL schemes and malicious Markdown. Admin spreadsheet export has **CSV formula injection**, a different output context (SEC-006).

## 17. CSRF result

No demonstrated cross-site privileged mutation. Better Auth origin/form-CSRF checks are enabled, and production cookies use SameSite=Lax. Ordinary cross-site unsafe requests therefore do not automatically carry the session. Same-origin JSON APIs do not require broad credentialed CORS.

Most custom mutation routes have no independent Origin/CSRF middleware; add exact-origin/Fetch-Metadata checks before broader deployment, especially admin mutations and same-site subdomain threats. Do not label every missing CSRF token as an exploitable bypass without accounting for cookie/content-type/origin behavior.

One real design concern: `GET /api/quiz/questions` starts a persisted attempt (`src/app/api/quiz/questions/route.ts:28-33`). Lax cookies can accompany cross-site top-level navigation to GET. This can create unwanted attempts for an already entitled victim. No such request was made while authenticated; move attempt creation to a protected POST or separately reviewed action. Severity LOW, no privilege escalation proven.

No Next.js server actions were found in current source; sensitive server mutations use route handlers.

## 18. SSRF, redirects and uploads

**SSRF:** no reachable student-controlled server fetch URL was found. Resend, Groq and dormant Paymob URLs are fixed server destinations. File resolution uses stored paths, not arbitrary HTTP input. Admin git-health commands are fixed strings, not client-provided shell commands. No cloud metadata/internal URL request was attempted.

**Open redirects:** sign-in navigates to fixed `/dashboard`; other application redirects are fixed local paths. Better Auth callback/recovery origins are validated by installed middleware. No arbitrary `next`/`returnTo` destination path was found to be consumed without validation.

**Uploads:** admin-only clean-image upload (`src/app/api/admin/practical-authoring/route.ts:133-187`) accepts PNG/JPEG/WebP extensions, creates UUID filenames under the private image root, and checks decoded bytes between 1 byte and 8 MB. It does not trust the submitted filename for the storage path and cannot upload an executable extension. It does **not** verify magic bytes or cap the raw base64 body before allocation. Recommend decoding/re-encoding supported images and early body/pixel bounds. Because access is admin-only and private image delivery has nosniff/sandbox protections, no student executable-upload/RCE path was demonstrated.

## 19. CORS result

No project wildcard credentialed CORS configuration found. Sample local responses had no `Access-Control-Allow-Origin`. Same-origin deployment does not require opening CORS. Better Auth trust uses exact origins; unrelated inactive OIDC/MCP library advisories do not establish CORS exposure in this app.

Reverse proxy/object storage CORS is outside the local evidence and still needs deployment verification.

## 20. Security headers result

`next.config.ts:5-20` configures nosniff, DENY framing, strict-origin-when-cross-origin referrer policy, restrictive camera/mic/geolocation permissions, and production HSTS. Local HTTP responses confirmed nosniff and DENY. No global CSP is configured. Practical image responses add sandbox CSP; other application pages do not.

Absence of a global CSP is LOW defense-in-depth, not a confirmed XSS vulnerability. Deploy a tested CSP/Report-Only rollout supporting Next/PDF workers; do not break the app by applying an untested blanket policy. HSTS is appropriate only with a working HTTPS production deployment; local HTTP need not advertise it.

## 21. Error and logging result

Legacy OSPE routes return arbitrary caught `Error.message` to clients (SEC-012). The isolated route proof returned a synthetic internal query marker with status 400. No real DB failure/secret was deliberately triggered. Other handlers generally return generic errors; local development's Next error overlays must not be exposed publicly.

`src/shared/logger.ts` redacts several nested password/token/secret/email/header fields; auth route logging uses pathname/status/timing, not bodies or query tokens. Some SDK/error handlers instead use raw `console.error` (`tutor/chat:241`, flashcards:129, cases:144, admin analytics:313), bypassing structured redaction. This is a **likely logging weakness**, not evidence that a real key was observed in logs. Improve deep/top-level redaction, sanitized error serialization and avoid full provider request objects. Retention/access controls for deployment logs were not verified.

## 22. Dependency audit result

Read-only `npm audit --json --ignore-scripts` exited 1 with **23 affected package entries: 1 critical, 13 high, 9 moderate**. These are registry audit categories, NOT 23 proven exploitable application vulnerabilities. No automatic upgrades or `npm audit fix` were run.

| Component | Installed/evidence | Reachability assessment |
|---|---|---|
| Runtime Better Auth | 1.6.29 | The vulnerable 1.4.22 copy is nested under the dev CLI, not the authentication import used by VYLO |
| `@better-auth/cli` | 1.4.22, devDependency | Its transitive old Better Auth/Drizzle and parser dependencies require controlled tooling upgrades; not current web auth takeover proof |
| Drizzle runtime | 0.45.2 | Patched identifier-escaping release; inspected dynamic sorts use server allowlists, not raw client SQL |
| Undici | 7.29.0, including AI SDK provider-utils | Runtime dependency needs update review; no app WebSocket/unsafe cache/attacker-selectable fetch path was found to reproduce the listed attacks |
| shadcn / glob / braces / ts-morph / ip-address | CLI/tool dependency paths; shadcn is in dependencies | Remove tooling from runtime delivery where appropriate; no student-controlled glob/parser sink found |
| lodash | Dev parser chain | No reachable application `template`/`unset`/`omit` attack sink found |
| esbuild | Old nested dev-tool copy | No exposed esbuild serving endpoint used by the app found; do not publicly expose developer tooling |

Primary maintainer advisories were checked: the OIDC/MCP refresh-token issue requires affected Better Auth versions **and those enabled plugins**, absent here ([Better Auth advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-pw9m-5jxm-xr6h)). The installed Undici version is inside the affected range for a WebSocket crash that requires a malicious/compromised WebSocket peer; the patched 7.x release is 7.29.1 ([Undici advisory](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5)). Drizzle's advisory explicitly concerns untrusted identifier construction and is patched in 0.45.2 ([Drizzle advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9)).

Advisory metadata can differ between registry and maintainer severity assessments. The npm critical entry is not a confirmed CRITICAL VYLO vulnerability. Dependency fixes still need targeted regression review before public launch; npm's suggested major downgrades are not a safe remediation plan.

## 23. Production configuration and database security result

**NOT production-ready on current evidence.**

- Local Next.js listens on `0.0.0.0:3000` (observed with netstat), not loopback-only. LAN reachability depends on Windows firewall, not checked. Do not expose this development server or its debug overlay through public tunnels/router forwarding.
- Local PostgreSQL listens only on `127.0.0.1:5432` and uses SCRAM-SHA-256 in inspected HBA rules. SSL is off on local loopback, which is not automatically a vulnerability. The app's local DB role is superuser with CREATE DATABASE; use a least-privilege production app role and encrypted remote connections. No SQL injection was proven: Drizzle/SQL value interpolation is parameterized; `sql.raw` identifiers/directions in analytics are server-selected allowlists.
- `docker-compose.yml` publishes dev PostgreSQL `5432:5432` without a loopback restriction and has a known local-password fallback. That is a **deployment risk**, not the observed current listener. Staging DB has no host-published port and requires a password.
- **Dockerfile structural blocker:** `FROM builder AS seed` at line 29 makes seed the default final stage. The later `USER nextjs`/`CMD node server.js` belong to that stage, but the user/standalone server are created/copied in the separate runner stage. Compose `build: .` does not target runner. Default deployment is therefore malformed. Choosing runner alone still does not apply the nonroot `USER` placed after the seed boundary. No Docker build/deployment was executed.
- Staging defaults to HTTP app-origin configuration without an accompanying HTTPS termination setup; this conflicts with secure-cookie expectations. Mail variables are not fully declared in its app configuration. Production secrets/base URL must be explicitly checked before deployment.
- Staging startup includes migration/seed dependencies. **Do not run this against the recovered current DB without a separate owner-approved backup/migration review.** No compose, seed or migration workflow was executed in this audit.
- `.dockerignore` excludes env, DB data, Git and backups. Build emitted nine warnings about tracing the whole project via dynamic filesystem access. Inspect actual release artifacts for unnecessary source/private/temp material; a warning does not itself prove a publicly served secret. Browser production source maps were not enabled in Next config.
- No privileged container flag or public management interface was found in inspected deployment files. Public health exposes only status/time, not credentials. Runtime/private storage durability, backups/restores, production monitoring and artifact contents remain unverified.

## 24. Confirmed CRITICAL findings

**None demonstrated.** No realistic current admin takeover, auth bypass, live payment forgery granting subscriptions, RCE, or exposed production credential was established. This is not assurance that unseen deployment paths are safe.

## 25. Confirmed HIGH findings

| ID | Finding | Important prerequisite |
|---|---|---|
| SEC-001 | Authenticated PDFs advertise public/shared cache lifetimes | Cross-user exploitation requires a shared cache that honors the header; no CDN reproduction |
| SEC-002 | Hosted Tutor retrieves protected same-module lecture chunks from a free-preview entry point without per-chunk authorization | Hosted AI enabled + verified student + available paid-module preview |
| SEC-003 | Premium hosted Tutor skips all daily reservations and lacks a per-user concurrency/spend ceiling | Hosted AI enabled + active subscription; any subscription is enough for this premium check |

These defects are confirmed in source and isolated route execution; they are not claims that a live attacker accessed the local DB or incurred a bill. Hosted AI is opted out in the inspected local env files. Full finding records appear in Appendix A.

## 26. Confirmed MEDIUM findings

| ID | Finding | Scope |
|---|---|---|
| SEC-004 | Legacy folder/unspecified OSPE exam and image paths bypass reviewed track/approval availability | Still authenticates/entitlement-checks; all actual station folders currently await Term 2 |
| SEC-005 | `/flashcards/all` and `/cases/all` display saved lecture derivatives without rechecking current lecture access | Owner-only; requires previously saved data, not access to another user |
| SEC-006 | Admin CSV exports preserve formula-leading student names | Requires admin to export/open CSV in formula-interpreting spreadsheet |

## 27. Confirmed LOW findings

| ID | Finding | Scope |
|---|---|---|
| SEC-012 | Legacy OSPE caught internal error messages are returned verbatim | Authenticated authorized OSPE path; synthetic marker proof only |
| SEC-013 | Battle answers are not bound to a server-selected question set/active state | Entitled participant can submit extra same-bank answers; competitive integrity, not payment/auth bypass |

State-changing quiz GET is additionally a LOW CSRF/design concern with no live authenticated reproduction (section 17).

## 28. Likely weaknesses and defense-in-depth recommendations

Likely weaknesses, not counted as demonstrated live vulnerabilities:

- SEC-007 MEDIUM: custom recovery lacks aggregate abuse limits and has read-then-write cooldown races.
- SEC-008 MEDIUM: misplaced auth limiter settings, process-local defaults and unverified proxy/IP trust.
- SEC-009 HIGH, dormant: missing Paymob HMAC secret makes the helper return true. Current webhook is disabled.
- SEC-010 MEDIUM, dormant: Practical provider call before reservation; ignored reservation failure; absent equivalent opt-in/body bound. All 11 images currently fail its module-ID-as-slug lookup.
- SEC-011 MEDIUM, deployment-dependent: seeded shared-password users/default admin credentials and unguarded operator seed workflows must not carry into externally exposed environments.

Defense-in-depth (LOW/INFO unless a new exploit is demonstrated): admin MFA/step-up for approvals/billing; tested global CSP; exact-origin mutation protection; shared throttles/verified proxy trust; generic error responses/sanitized logs; least-privilege DB user; early body/pixel limits and image re-encoding; env-file ignore/secret scanning; tooling separated from runtime dependencies; checked production Docker stages/TLS; secret-free artifact inspection; provider global budget/circuit breaker; deterministic backup/restore rehearsal.

PDF-specific hardening: enforce approved segment availability at the API, not just the UI. If a stored file is shared/has out-of-range pages, return only its validated lecture segment or deny; do not trust a client viewer's page controls. Seven current previews were checked and are not leaking extra pages.

Publication/metadata policy: explicitly decide whether draft curriculum and locked titles should be public. Current schemas do not have a general lecture publication state. No automatic content publication/inference should be introduced as an audit fix.

## 29. P0 - before any external users

1. Fix SEC-001 PDF cache headers; verify a paid response cannot be served to an unauthenticated/different user by any configured CDN. Purge previously public cached objects if deployment evidence requires it.
2. Fix SEC-002/003 **before enabling hosted Tutor for external users**. Keep opt-in OFF until per-context authorization and all-user spend/concurrency budgets pass. Do not remove the Practical lookup blocker without SEC-010 budget/role review.
3. Establish a safe external testing environment: production-mode HTTPS, no publicly reachable dev server/PostgreSQL, no copied shared-password fixture accounts. Review SEC-011 and deployment configuration before opening access; do not auto-delete local users.
4. Complete a legitimate authenticated read-only role/IDOR test plus controlled session/reset tests in an owner-approved isolated test database. This audit deliberately did not mutate the existing DB to provide those proofs.

## 30. P1 - before public launch

1. Fix SEC-004 at **all** legacy entry points before Term 2/OSPE availability; reuse explicit reviewed module+subject tracks and verified image/answer readiness. Never infer subjects from filenames or auto-enable stations.
2. Fix SEC-005 after owner confirmation of derivative-retention policy; centralize current entitlement/release checks for every library page/API.
3. Fix SEC-006 CSV formula escaping; SEC-007/008 auth/recovery budgets; SEC-012 sanitized errors. Add their focused regression tests.
4. Address runtime dependency advisories in reviewed small upgrades and reconcile tooling copies/lockfile. Correct Docker final-stage/nonroot/HTTPS configuration and inspect built artifacts.
5. Before real payments specifically: SEC-009 plus full trusted amount/currency/order verification, event idempotency/transaction/replay/status tests. Keep checkout, webhook and redeem confirmation disabled until that separate approval.

## 31. P2 - before scale; P3 optional hardening

**P2:** shared multi-instance limits with trusted proxy identity; provider-wide spend cap and accurate usage accounting; quota fallback fails closed; early request-size/concurrency bounds; avoid unbounded/N+1 query work; server-bound battle questions and atomic terminal state (SEC-013); move quiz attempt creation away from GET; least-privilege DB/TLS; image content validation; backup/restore, log retention and deployment secret scanning.

**P3:** CSP report-only rollout/strict final policy, additional browser payload regressions, further session/admin step-up controls, dependency/runtime minimization, automated checks for alternate static origins. Some items become P1 if deployment introduces the prerequisites; priority is contextual, not permission to ignore a demonstrated public exploit.

## 32. Existing security controls that work correctly

Server admin guards; protected role input; required email ownership verification; salted password hashing; signed/HttpOnly cookies; reset session revocation and one-time token consumption; no auth wildcard origins; release AND period AND entitlement composition; admin year retention; fail-safe missing associations; search per-hit checks; quiz bank/question/option/attempt ownership; notes/cards/cases ownership; approved Practical question+image gating; development-only fixture exclusion; answer-free student DTOs; saved-answer acknowledgment before feedback; Practical idempotent transactional progress; track-specific OSPE checks; static PDF/card proxy blocks; private image paths; disabled live payments; constant-time cron authentication.

These controls do not negate the alternate-path findings.

## 33. False positives investigated / already protected

- Shared-source preview PDF leak: **not present in the seven current previews**; all 248 PDF lecture paths are distinct. Retain a future API invariant rather than claim recovered content is leaking today.
- Changing role to admin via JSON: protected by Better Auth `input:false`/profile allowlist and server RBAC.
- First-lecture preview/free subscription bypassing unreleased years/future periods: denied before preview/entitlement.
- Draft Practical/production fixtures: eligibility requires approval and fixture flags; no approved questions currently exist. The legacy OSPE exception is separate.
- Direct public study-card/reference PDF path: real HTTP 404 from proxy.
- Global RAG index by itself: search correctly post-filters; only Tutor's missing post-filter is a finding.
- Missing HMAC secret causing a paid subscription today: current webhook returns 503 without activation. The dormant helper is unsafe for a future payment rollout.
- Installed `rehype-raw` implying XSS: not enabled in the active renderer.
- npm critical total implying current auth takeover: vulnerable nested CLI copy/plugins are not the runtime auth path.
- Local loopback PostgreSQL without TLS: not a remote plaintext exposure; current listener is loopback with SCRAM. Docker host-port defaults are different.
- Loose key-pattern history matches: schema/reference identifiers, not provider keys; strict 132-commit rerun had zero matches.
- Owner-bound score/history metadata is not automatically another-user data leakage. Main quiz analytics/history recheck access; old battle history still exposes its owner's bank slug/score metadata after revocation, requiring an explicit retention policy rather than a guessed critical rating.

## 34. Tests result and security coverage

`npm test`: **PASS, 972 tests across 77 files**, exit 0. Existing tests were run once as the full gate; no test files were changed/added. Tests largely mock DB/session/AI dependencies, so this is not production penetration-test coverage.

| Required security coverage | Evidence/result |
|---|---|
| Student cannot access admin | Admin analytics API tests + unauthenticated HTTP + server guards; authenticated real browser not exercised |
| Student cannot access Years 3-5 | Central release and actual-helper route tests; no live Year-3-5 lectures exist |
| Future terms and Summer denied | Academic boundary/server tests, including free/entitled cases |
| Subscription bypass denied | Central access tests and authoritative route/DB relationships; exceptions documented |
| Direct hidden modules/lectures | `student-release-access.test.ts`, `academic-access.test.ts` |
| Unauthorized AI denied | Hidden-year generation tests deny before provider/quota/persistence |
| Admin remains authorized | Visibility/admin analytics tests; no live admin session created |
| Ownership isolation | Access/Practical/OSPE/case/review tests and server predicates |
| Payment callbacks cannot forge paid state | Disabled webhook source; HMAC tests do NOT cover a complete payment lifecycle and one asserts fail-open |

Additional in-memory audit proofs, executed from stdin without saving files:

- Tutor denied-source marker reached provider mock/X-Sources; only requested preview authorized. Premium call added zero quota reservations.
- PDF route forwarded public-cache headers without Cookie variation and called storage with file only, not bounds.
- Legacy OSPE route returned 200 for a mocked entitled folder with no track resolution while scoped unavailable request returned 404. Actual `startExam` selected an unassociated answer key using DB mocks.
- Stored flashcard back survived rendering with no lecture-access check.
- Actual CSV helper preserved harmless `=1+1`; no spreadsheet was opened.
- Actual legacy OSPE answer route returned a synthetic internal error marker.
- Path containment denied traversal outside the image root.

Missing regression coverage: actual production auth config/cookie/origin/role injection/session/reset lifecycle; all alternate context/legacy/library paths above; shared-cache two-user/anonymous behavior; CSV formulas; aggregate recovery budgets and cooldown concurrency; provider quota under simultaneous requests/different keys; trusted proxy IP behavior; full payment authenticity/idempotency; real deployment TLS/artifact/static-origin checks. Existing security E2E scripts were inspected but NOT run because they create users/subscriptions and otherwise mutate data.

## 35. Typecheck result

`npm run typecheck`: **PASS**, exit 0 (`tsc --noEmit`). Run after the build to avoid races with generated Next types.

## 36. Lint result

`npm run lint`: **PASS, 0 errors, 197 existing warnings**, exit 0. No warning cleanup or code repair was attempted.

## 37. Build result

`npm run build`: **PASS**, exit 0. 79 pages generated; nine dynamic-filesystem tracing warnings. These are deployment/artifact-review concerns, not confirmed publicly accessible secret files.

## 38. Files changed

Application/source/configuration files: **NONE**. Existing WIP fingerprint unchanged. Sole intentional audit output: **`SECURITY_AUDIT.md`**, as explicitly requested. Historical reports and `CURRENT_STATE.md` were not rewritten. Ignored normal gate outputs may be refreshed.

## 39. Database changed

**NO.** Audit queries were SELECT-only inside `READ ONLY` transactions. Counts/fingerprints unchanged. No migrations, seeds, resets, account/role/password/session changes, verification email, subscription/payment mutation or station mapping application. No paid AI requests.

## 40. Commit

**NONE.** HEAD remains `ce0403ab532cf982cc6ef41038c4083743821f44`. No staging/reset/clean operation was used.

## 41. Push

**NONE.** No branch merge, push, force-push, secret rotation or external product-state write.

## Appendix A - Finding records

### SEC-001 - Protected PDF responses are eligible for shared caching

- Classification/severity: **confirmed vulnerability, HIGH** (unsafe policy confirmed; CDN bypass deployment-dependent).
- Component/route/files: `/api/content/pdf/[lectureId]`; route lines 16-30; `src/shared/storage.ts:176,208`.
- Issue/evidence: successful authorization is followed by a `public` response with one-day browser/seven-day shared-cache lifetime and no Cookie variation. Both storage drivers set it; the route returns it unchanged.
- Scenario/prerequisite: an entitled request populates a configured shared cache; the same URL is then served to a different/unauthenticated user without reaching origin authorization. Requires a cache that honors this policy; not proven against a live CDN.
- Impact: paid lecture PDF disclosure and delayed entitlement revocation across a cache boundary.
- Safe reproduction: actual route with storage/session mocks preserved the unsafe header; no protected PDF was downloaded over HTTP or shared cache attacked.
- Smallest fix: override the protected route to private/no-store and suitable Cookie variation; ensure CDN bypasses it and purge affected objects where applicable.
- Regression: same PDF URL as entitled A, unentitled B and anonymous; no shared hits across actors, including revoke/expiry; local and S3 branches.

### SEC-002 - Hosted Tutor authorizes only the entry lecture, not retrieved context

- Classification/severity: **confirmed vulnerability, HIGH**, gated by hosted opt-in.
- Component/route/files: `/api/tutor/chat`; `route.ts:131,180-196,228-235`; `src/features/rag/index.ts:24-57`.
- Issue/evidence: the global index includes lecture text; retrieval filters module slug but no lecture access. All returned chunks and their titles enter prompt/source headers.
- Scenario/prerequisite: a verified student opens an available paid module's first free preview, then asks about another same-module lecture. Hosted mode retrieves its protected text despite missing full-module entitlement.
- Impact: protected paid context reaches a third-party provider and may be disclosed in response/source metadata. Cross-module/future-year bypass was NOT demonstrated because the module filter and entry guard still apply.
- Safe reproduction: actual route with one forbidden chunk; provider mock received the marker and client X-Sources named the denied lecture; no access check called for that chunk. Zero actual AI calls/writes.
- Smallest fix: authorize each retrieved lecture and filter before prompt/header construction (same mechanism as search), or scope preview retrieval strictly to the allowed lecture. Fail closed on missing/denied IDs.
- Regression: preview/free/premium/expired/admin; authorized and denied same-module chunks; no denied title/text in prompts or headers; hidden-year/future entries denied before retrieval.

### SEC-003 - Premium hosted Tutor has no finite enforced cost budget

- Classification/severity: **confirmed vulnerability, HIGH**, gated by hosted opt-in.
- Component/route/files: `/api/tutor/chat`; `route.ts:140-153,214-225`; `src/shared/ai-client.ts:35-45`.
- Issue/evidence: `hasAnySubscription` bypasses reservation; no alternative premium quota/rate/concurrency cap. Output/timeout caps bound each call, not total calls. Usage writes record zero token counts.
- Scenario/prerequisite: an authenticated active subscriber makes repeated hosted requests with different messages/sessions. There is no application-enforced maximum count; slow/capped individual calls still accumulate cost.
- Impact: unbounded provider spend and resource contention relative to a subscription price; no dollar estimate asserted.
- Safe reproduction: actual route with premium mock reached provider with zero additional reservation calls. No paid traffic/load test.
- Smallest fix: retain an atomic spend/request reservation for all users with explicit plan budgets plus concurrency/global circuit breaker; record actual stream usage. Do not rely solely on per-message token caps.
- Regression: free/premium/admin all bounded; concurrent last-slot reservation; no cost when unauthorized; cancellation/provider error/idempotency; aggregate budget enforcement.

### SEC-004 - Legacy OSPE bypasses reviewed module/subject availability

- Classification/severity: **confirmed vulnerability, MEDIUM**, currently ordinary-student-blocked by Term-2 dates.
- Component/route/files: `/api/ospe/exam`, `/api/content/ospe/image`; exam route 49-78; `src/features/ospe/exam.ts:46-65`; `learning-access.ts:334-340`; image route 32-39.
- Issue/evidence: folder/empty-scope exam creation omits track availability and selects answer keys by folder. Legacy resume checks folder entitlement only. Image route treats answer-key existence as reviewed approval, without checking a reviewed station association/published enabled track.
- Scenario/prerequisite: a student entitled to an academically available OSPE module calls the legacy folder API or guesses/obtains an answer-key filename while the subject dashboard is disabled/unreviewed.
- Impact: unreviewed station/image exposure and bypass of subject/publication configuration. It does NOT bypass module entitlement or cross-user exam ownership. Actual DB: 759 keys, zero associations; all folders currently wait for Term 2.
- Safe reproduction: actual route and actual station-selection function with mocks showed legacy success/unassociated selection versus scoped 404. No live exam was created. Image predicate confirmed by source; no unauthorized real image fetched.
- Smallest fix: require explicit authoritative reviewed module+subject scope at all entry/resume/image paths; deny legacy unassociated keys rather than infer subjects. Validate ready images/answer/rubric before availability.
- Regression: zero associations -> no exam/image through every legacy/scoped route; wrong module/subject denied; valid association works; owner isolation and academic entitlement preserved.

### SEC-005 - Saved derivative pages omit current access checks

- Classification/severity: **confirmed vulnerability, MEDIUM**, under the current API's reauthorization policy; owner must confirm retention intent.
- Component/route/files: `/flashcards/all`, `/cases/all`; cards page 12-23,75; cases page 11,79-95; `src/features/review/queries.ts:163-186`.
- Issue/evidence: these pages read the owner's stored data but do not call current lecture/case access helpers. Their corresponding APIs do recheck entitlement/release.
- Scenario/prerequisite: previously entitled user retains saved derivatives after subscription expiry or a module becomes hidden; direct library URL displays card fronts/backs, lecture titles or case text despite API denial.
- Impact: continued protected derivative content/metadata disclosure, not another user's notes/cards/cases. CSS line clamping of case text is not server-side redaction.
- Safe reproduction: actual flashcards page rendered a mocked denied lecture's saved back without any access dependency; no DB access. Cases path confirmed from source.
- Smallest fix: filter library query results with centralized current access before server rendering/serialization, or explicitly revise and consistently enforce an owner-approved retention policy.
- Regression: expiry, unreleased year, inactive Summer and future period hide derivatives in pages/APIs; valid owner/admin behavior remains; cross-user IDs denied.

### SEC-006 - CSV formula injection from student-controlled names

- Classification/severity: **confirmed vulnerability, MEDIUM**, requiring spreadsheet interaction.
- Component/route/files: admin analytics CSV export; `src/features/admin/analytics.ts:1970-1989`; `/api/admin/analytics?view=users&csv=1` route 151-174; student profile route 20-24.
- Issue/evidence: CSV escapes quotes/commas/newlines but not formula-leading characters. A student can set their own name; admin exports that name.
- Scenario/prerequisite: malicious student submits a formula-looking name; admin downloads and opens exported users/subscription/activity CSV in a formula-interpreting spreadsheet.
- Impact: unexpected formula execution, phishing or data exfiltration subject to spreadsheet capabilities/warnings. No claim of demonstrated host RCE.
- Safe reproduction: actual helper preserved harmless `=1+1`; no account mutation or spreadsheet execution.
- Smallest fix: neutralize leading formula prefixes/control whitespace at CSV export for all untrusted cells, in addition to CSV quoting.
- Regression: `=`, `+`, `-`, `@`, leading tabs/newlines/whitespace and quoted fields from name/title/text; normal numbers/date/export headers preserved.

### SEC-007 - Recovery cooldown is not an aggregate abuse limit

- Classification/severity: **likely weakness, MEDIUM**; traffic/cost exploitation not attempted.
- Component/route/files: `/api/password-recovery/request` and `/resend`; `password-recovery.ts:63-117,120-141`; request route.
- Issue/evidence: budgets are per email or challenge; different arbitrary emails create challenge rows even when no user exists. Cooldown check and write/send are not a serialized reservation. These routes bypass Better Auth's limiter.
- Scenario/prerequisite: public requester varies emails/IP headers or overlaps requests just outside cooldown. Can accumulate DB work/rows and, for known real recipients, send mail. SMTP/provider failure can also distinguish known/unknown recipients by response/latency.
- Impact: resource/mail abuse and possible enumeration; bounded OTP verification itself is not bypassed by this evidence.
- Safe reproduction: source review only; no reset/code/email traffic or concurrent writes.
- Smallest fix: shared aggregate IP/account/global budgets and serialized cooldown reservation, bounded inputs/retention; keep generic responses across delivery outcomes.
- Regression: varied emails from same IP, repeated challenge resends, concurrent cooldown boundary, unknown/known error shapes, bounded verification and one-time consumption preserved.

### SEC-008 - Auth rate-limit configuration is not read as intended

- Classification/severity: **likely weakness, MEDIUM**; ignored configuration confirmed, production brute-force bypass not live-tested.
- Component/files: `src/shared/auth.ts:119-133`; installed `better-auth/dist/context/create-context.mjs:169-174` and `api/rate-limiter/index.mjs:370-383`.
- Issue/evidence: project puts limits under `advanced.rateLimit`; library consumes top-level `options.rateLimit`. Defaults are memory/IP based; installed IP helper trusts configured/default forwarded headers absent deployment sanitization.
- Scenario/prerequisite: development server exposed, multiple production instances, or an untrusted forwarding-header path. Intended configured limits do not supply the promised protection.
- Impact: weaker/uneven throttling and ineffective operator assumptions. Production still has default 3/10s sign-in rules; do not falsely report zero protection everywhere.
- Safe reproduction: installed source/config inspection, no login guessing or rate/load traffic.
- Smallest fix: move configuration to supported root location; verify effective settings via pure config tests; shared storage and sanitized proxy identity for production.
- Regression: actual production/development limiter enabled/rules; multi-instance counter; forwarded-header spoof rejection at deployment boundary; OTP cooldown behavior.

### SEC-009 - Dormant HMAC verification fails open

- Classification/severity: **likely weakness, HIGH if payment processing is enabled**; confirmed unsafe helper, not a current reachable payment exploit.
- Component/files: `src/shared/paymob.ts:135-180`; `src/features/billing/paymob.test.ts:89`; disabled webhook route.
- Issue/evidence: missing secret returns true; test explicitly asserts this. No complete active payment reconciliation/idempotency pipeline exists yet.
- Scenario/prerequisite: future developer wires this helper into subscription activation while the HMAC secret is absent/misconfigured.
- Impact: potential forged payment acceptance/paid entitlement. Current webhook's unconditional 503 prevents this path.
- Safe reproduction: existing unit tests plus source; no payment/provider calls.
- Smallest fix: fail closed, strict payload/signature validation and constant-time comparison, then separately implement trusted amount/currency/order/integration/status verification and atomic event handling.
- Regression: missing/invalid signature/secret always rejects; wrong amount/currency/merchant/order; replay/concurrency; no access from client callbacks; disabled mode never writes.

### SEC-010 - Practical generation has a latent post-call quota race

- Classification/severity: **likely weakness, MEDIUM**, currently unreachable for all existing source images due to another blocker.
- Component/files: `/api/practical/generate`; route 69,113-136,255-260; `src/features/practical/http.ts:8-19`.
- Issue/evidence: module ID is passed to a slug resolver; all 11 image rows have module IDs different from slugs. If fixed, generation checks a quota count, calls provider, then reserves after success and ignores denial. No equal hosted opt-in or prompt max; authoring is not admin-only.
- Scenario/prerequisite: lookup starts succeeding and provider is configured; an entitled user overlaps distinct generation keys while below quota. Multiple costs occur before any reservation.
- Impact: excess provider cost, unbounded prompt processing/shared drafts; explicit approval still prevents auto-publication.
- Safe reproduction: source + SELECT counts; no provider call or draft insert. Do not label this presently reachable on the current database.
- Smallest fix: jointly review correct authoritative module lookup, intended authoring role/source eligibility, pre-call atomic reservation, opt-in and prompt/body limits. Do not repair only the lookup.
- Regression: current IDs resolve legitimately; unauthorized actor/source denied before AI; last-slot concurrency; no key/opt-in/no approval path; failures do not create approved content.

### SEC-011 - Shared/default development credentials must not be deployed

- Classification/severity: **likely weakness, MEDIUM**, external-deployment prerequisite; no exposed production credential confirmed.
- Component/files: seed defaults `scripts/seed-admin.ts:7-8,19,35`, `scripts/seed-test-users.ts:14,77,95-106`; dev DB/test scripts; staging seed/deployment.
- Issue/evidence: known repository defaults/shared test passwords and no robust production guard in these operator scripts; seed admin promotes matching existing account. Local aggregate shows 100 verified students sharing one credential hash.
- Scenario/prerequisite: an operator copies this database or runs test/admin seed defaults against an externally reachable environment.
- Impact: impersonation of fixture users; potential admin compromise if the admin default is actually used. This audit did not compare the current admin password or test logins.
- Safe reproduction: redacted source + aggregate counts only; no password/hash output or mutation.
- Smallest fix: forbid production/test seeding/default privileged credentials and establish an owner-approved separate deployment account/credential strategy. Do not auto-delete/reset local accounts.
- Regression: production invocation/default admin secret refused; test fixtures isolated; existing recovered curriculum unaffected; external dataset contains no shared-password fixture users.

### SEC-012 - Legacy OSPE returns internal error text

- Classification/severity: **confirmed vulnerability, LOW**.
- Component/files/routes: `/api/ospe/exam` route 88-91, `/api/ospe/exam/[examId]` route 80-83.
- Issue/evidence: generic caught `Error.message` returned verbatim, including possible ORM query/path detail rather than an allowlisted client error.
- Scenario/prerequisite: authorized caller triggers an unexpected internal error; some unbounded/loosely validated legacy inputs make that more plausible.
- Impact: internal schema/query/path information. No real credential leak proven.
- Safe reproduction: actual route with synthetic thrown internal marker returned status 400 with the marker; no real DB failure/write.
- Smallest fix: validated inputs + allowlisted public errors; unexpected errors generic and sanitized server logs.
- Regression: synthetic SQL/provider/path errors never appear in responses; legitimate validation/not-found cases remain actionable.

### SEC-013 - Battle answer membership/phase is not server-bound

- Classification/severity: **confirmed vulnerability, LOW**, source-confirmed integrity gap; no live farming attempted.
- Component/routes/files: `/api/battles/answer` route 31-45; `src/features/gamification/battles.ts:73-87,90-150`; battle finish route 24-32.
- Issue/evidence: answering validates participant + accessible bank/question/option, but not battle active phase, the configured question count or a persisted selected question set. The helper upserts any same-bank question and finish sums all stored correct answers.
- Scenario/prerequisite: an entitled participant submits extra bank question IDs or repeatedly overwrites answers rather than using the intended fixed battle set; scores can exceed the configured battle question count. Finish checks active status, but the answer path does not.
- Impact: unfair competitive score/win statistics and leaderboard rewards; no unrelated user's credentials, subscription or curriculum access.
- Safe reproduction: source inspection only; no answer/XP writes or concurrent requests.
- Smallest fix: server-bind permitted questions/count and active phase, disallow unauthorized answer replacements/terminal mutations, and atomically finalize once.
- Regression: extra same-bank question denied; waiting/finished battle answer denied; replay/idempotency/finalize concurrency; participant/bank entitlement preserved.

## Appendix B - API inventory (59 route files)

Legend: `A` = authenticated; `R` = server admin role; `L` = central module/lecture academic release + period + entitlement; `O` = actor-derived ownership; `T` = authoritative published Practical module/subject/approval scope; `Public` = deliberately unauthenticated; `OFF` = rejects paid activation. Each listed path maps to `src/app/api/<path>/route.ts`; dynamic placeholders retain their source filename.

| # | API path | Methods | Server boundary / observations |
|---:|---|---|---|
| 1 | admin/academic-periods | GET, PATCH | A/R before DB; allowlisted date/status fields |
| 2 | admin/analytics | GET | A/R; paginated views, allowlisted sorts; CSV issue SEC-006 |
| 3 | admin/audit | GET | A/R; administrative records only |
| 4 | admin/lectures | GET, POST, PUT, DELETE | A/R; privileged curriculum authoring |
| 5 | admin/modules | GET, POST, PUT, DELETE | A/R; privileged curriculum authoring |
| 6 | admin/practical-authoring | GET, PATCH | A/R; explicit actions/private upload/approval |
| 7 | admin/practical-images/[imageId] | GET | A/R; private image containment |
| 8 | admin/practical-review | GET, POST | A/R; approvals remain privileged |
| 9 | admin/promo-codes | GET, POST, PATCH | A/R; privileged pricing configuration |
| 10 | admin/redeem-codes | GET, POST, PATCH | A/R; privileged redeem configuration |
| 11 | admin/reorder | POST | A/R; privileged curriculum order |
| 12 | admin/stats | GET | A/R; aggregate admin data |
| 13 | admin/subscriptions | GET, POST | A/R; client userId is allowed only in trusted admin operation |
| 14 | auth/[...all] | GET, POST | Better Auth credential/session/origin/role parsing boundary |
| 15 | battles | GET, POST | A; participant O + bank L for detail/create/join; own history metadata retention |
| 16 | battles/answer | POST | A/O/L; option correctness server-side; missing game-set/phase SEC-013 |
| 17 | battles/banks | GET | A; bank/module accessibility filtering |
| 18 | battles/finish | POST | A/O/L; active-state check; atomic finalization hardening needed |
| 19 | battles/ready | POST | A/O/L; participant readiness |
| 20 | billing/checkout | POST | A; plan academic checks; OFF 503 |
| 21 | billing/cron | GET | Constant-time Bearer secret; missing secret denied; authorized expiry mutates |
| 22 | billing/price-preview | POST | Public pricing preview; server pricing/visibility; no activation |
| 23 | billing/purchase | POST | A; plan academic checks; OFF 503 |
| 24 | billing/summer-preview | POST | Public price/config preview + academic Summer policy; no activation |
| 25 | billing/webhook | POST | OFF 503; no payment processing |
| 26 | content/ospe | GET | A; visible module entitlement metadata + reviewed track availability |
| 27 | content/ospe/image | GET | A/L folder; answer-key existence only, SEC-004 |
| 28 | content/ospe/pdf | GET | A/L folder + filename allowlist; private/no-store |
| 29 | content/ospe/station | GET | A/L; published/enabled association-based selection |
| 30 | content/pdf/[lectureId] | GET | A/L, first preview permitted; unsafe shared-cache policy SEC-001 |
| 31 | content/study-card/[lectureId] | GET | A/L, first preview permitted; private/no-store |
| 32 | curriculum/toggle | POST | A/L + session-owned progress; first preview permitted |
| 33 | health | GET | Public SELECT 1/status/time only |
| 34 | leaderboard | GET | A; public-within-app ranking; requested user progress must match actor |
| 35 | lecture-notes | GET, POST, DELETE | A/O; L on read/create; own delete only |
| 36 | ospe/exam | POST | A/L/T for scoped path; legacy folder bypass SEC-004 |
| 37 | ospe/exam/[examId] | GET, POST | A/O/L; association check when track-bound; legacy publication gap |
| 38 | password-recovery/request | POST | Public; email cooldown/capability creation; aggregate gap SEC-007 |
| 39 | password-recovery/resend | POST | Public challenge capability + cooldown; SEC-007 |
| 40 | password-recovery/reset | POST | Public valid challenge/reset-token capability + password bounds |
| 41 | password-recovery/verify | POST | Public challenge capability + expiry/atomic bounded code attempts |
| 42 | planning/weekly | GET | A/O; current visible/released module plan selection |
| 43 | practical | GET, POST, PATCH | A/L/T/O; approved catalog, saved-answer feedback, owned flags |
| 44 | practical/generate | POST | A + source/track/module check; current lookup blocker/latent SEC-010 |
| 45 | practical/images/[imageId] | GET | A/L/T; eligible question image only; private/sandbox |
| 46 | practical/ospe/image | GET | A/L/T reviewed association; wrong module/subject denied |
| 47 | quiz/answer | POST | A/O/L; bank/question/option relationships; server correctness |
| 48 | quiz/bookmark | GET, POST | A/O/L; actor's bookmark only |
| 49 | quiz/finish | POST | A/O/L; trusted attempt result |
| 50 | quiz/questions | GET | A/L; answer-safe DTO; creates attempt on GET |
| 51 | redeem | POST | A; preview/config checks; confirmation OFF |
| 52 | review/answer | POST | A/O/L; owned review + server option grading |
| 53 | review/cases | GET, POST | A/O/L; full lecture for generation; shared quota/idempotency |
| 54 | review/cases/evaluate | POST | A/O/L; owned case; quota before hosted evaluation |
| 55 | review/flashcards | GET, POST | A/O/L; full lecture for generation; shared quota/idempotency |
| 56 | review/flashcards/review | POST | A/O/L; actor card rating |
| 57 | search | GET | A; each retrieved source L before metadata/snippet |
| 58 | tutor/chat | POST | A/L entry only; RAG/context and Premium budget SEC-002/003 |
| 59 | user/profile | PUT | A/O; name allowlist only; no role/verification/subscription input |

## Final verdict

- **Local/private testing:** conditionally acceptable for the owner on a trusted machine/network, with hosted AI opted out and payments disabled. The current all-interface dev-server bind is not permission to expose it. Preserve the recovered database and avoid running mutating E2E/seed workflows against it.
- **External student testers:** not approved yet. Fix PDF shared-cache policy; establish an isolated HTTPS production-mode test environment without shared-password fixtures; finish legitimate authenticated role/IDOR verification. Keep hosted Tutor disabled until context and all-user budgets are fixed. Resolve legacy OSPE before its Term-2 data becomes available.
- **Real payments:** NO. Checkout/webhook must remain disabled until fail-closed signature verification, trusted amount/currency/order matching, atomic idempotency/status/entitlement flow and their tests pass a separate review.
- **Public launch:** NO on current evidence. Resolve P0/P1 findings and production/dependency/deployment blockers, then validate real role isolation, CDN/static delivery, TLS/cookies, recovery abuse limits, and content approval behavior in the intended release environment.

Next proposed implementation task, only after owner review: **fix protected PDF cache policy and add isolated local/S3 plus two-user/anonymous cache-boundary tests, without modifying curriculum/PDF files or mappings**. Do not bundle the rest of the remediation into that change.

Audit stopped. No fixes, database changes, commit or push performed.
