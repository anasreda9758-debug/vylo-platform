# VYLO staging deployment report

2026-10-03, Africa/Cairo. **B. DEPLOYMENT BLOCKED — OWNER ACTION REQUIRED.**
No deployment was attempted against an unknown host. No staging URL exists that can honestly be reported or smoke-tested.

## Deployment discovery

Repository specifies a single-VPS Docker/Next.js standalone/PostgreSQL stack with Caddy HTTPS in docker-compose.staging.yml. No named VPS/hosting provider, actual staging DNS name or reachable deployment host was found in the scoped deployment configuration.

GitHub CLI is authenticated and can read this repository's deployment configuration. The repository API reports **0 Actions secrets and 0 GitHub environments**; no repository variable names were returned. STAGING_HOST, STAGING_USER, STAGING_SSH_KEY and STAGING_DOMAIN are absent from the current shell; .env.staging and local SSH config do not exist. Docker/Caddy executables are unavailable locally. GitHub access is not VPS/provider access.

The general docker-compose.yml publishes PostgreSQL 5432 and is NOT the secure staging entry point. Use only the reviewed docker-compose.staging.yml, which publishes Caddy 80/443 and neither app 3000 nor DB 5432.

## Requested results

| # | Item | Result |
|---|---|---|
| 1 | Starting HEAD | cd783a7e83b1651b0ec5c3a582dfbd2238526eb0, branch wip/renal-anatomy-practical |
| 2 | Architecture used | Inspected/prepared existing single-VPS Docker, production Next.js standalone, Caddy, private PostgreSQL; not deployed |
| 3 | Provider | NOT CONFIGURED / NOT IDENTIFIED; GitHub Actions is the existing deploy orchestrator, not a hosting provider |
| 4 | Staging URL | UNAVAILABLE; no owner-approved domain/provider URL supplied or configured |
| 5 | Real deployment completed | NO |
| 6 | HTTPS certificate | NOT TESTED — no deployed endpoint; not a demonstrated certificate failure |
| 7 | HTTP→HTTPS | NOT TESTED remotely; Caddy automatic redirect configuration retained |
| 8 | Better Auth staging URL | Config enforcement PASS in tests; actual host configuration NOT CONFIGURED |
| 9 | Secure cookies | Production Secure/HttpOnly/SameSite=Lax code/config PASS; actual HTTPS browser NOT TESTED |
| 10 | Staging database | NOT CREATED/CONFIGURED — no identified staging target |
| 11 | DB publicly exposed | NO in prepared staging topology; actual external networking NOT VERIFIED because no host exists |
| 12 | Migration/seed | NOT RUN. Existing migration runner applies historical pending SQL; seed invokes admin/plans/import-content/quiz scripts. It is not a verified export of the recovered 44/394/740 dataset and must not run blindly. |
| 13 | Modules | Source/dev 44, unchanged; staging NOT AVAILABLE |
| 14 | Lectures | Source/dev 394, unchanged; staging NOT AVAILABLE |
| 15 | Questions | Source/dev 740, unchanged; staging NOT AVAILABLE |
| 16 | Anonymous protected PDF | Staging NOT TESTED. Deterministic route authorization regression PASS; do not equate localhost/unit checks with staging |
| 17 | Authorized PDF architecture | Existing server-authorized route + read-only private content mount; no Caddy static alias or public PDF mount |
| 18 | PDF cache | private, no-store and CDN no-store preserved in actual-route tests; actual deployed headers NOT TESTED |
| 19 | Student curriculum | Policy regression PASS: current Year 1 rules; unmapped Year 2, Years 3–5, future term/inactive Summer blocked. No dates changed |
| 20 | Admin protection | Existing session/Admin guards retained; real remote anonymous/Student/Admin checks NOT TESTED |
| 21 | Persisted-content regression | PASS, owner binding and current source/entitlement policy; actual staging multi-session test pending |
| 22 | Tutor regression | PASS, all retrieved source authorization and forged identity protections |
| 23 | AI quota regression | PASS, finite atomic shared reservation and subscriber/Admin/no-DB bypass protection |
| 24 | Daily limit | 15 operations per authenticated user/day; unchanged. Hosted staging AI remains opt-in, no paid requests made |
| 25 | Real payments active | NO deployment or payment activation performed; secure staging config keeps provider credentials absent |
| 26 | Production Paymob credentials used | NO |
| 27 | Production webhook active | NO production webhook configured/activated by this task |
| 28 | Security headers | Existing HSTS, nosniff, DENY, referrer/permissions policy verified in configuration; no speculative CSP. Remote response NOT TESTED |
| 29 | Error leakage | Actual staging NOT TESTED; no external requests possible. Environment validator prints field names only, not values; error-hardening findings are not claimed resolved here |
| 30 | HTTPS health/smoke | NOT TESTED — no actual staging URL. No localhost response presented as deployed success |
| 31 | Full tests | PASS, 1199 / 84 files, rerun this task in current working tree including preserved WIP |
| 32 | Focused security | PASS, 314 / 16 files, rerun this task |
| 33 | Typecheck | PASS, npm run typecheck after build |
| 34 | Lint | PASS, 0 errors / 197 existing warnings |
| 35 | Build | PASS, npm run build; 9 existing filesystem-tracing warnings. Real Docker image/build artifact NOT VERIFIED |
| 36 | Files changed | Only this new STAGING_DEPLOYMENT_REPORT.md; no application/config modification was needed before resolving missing deployment access |
| 37 | Secrets committed | NO; no secrets generated, revealed or committed |
| 38 | Schema changes | NO |
| 39 | Dev/source data changes | NO. SELECT-only audit confirms baseline counts and unchanged module/lecture/period fingerprints |
| 40 | New commit | NONE — deployment configuration unchanged; report remains local as requested preparation evidence |
| 41 | Push | NOT RUN; no new code/config commit or merge |
| 42 | Student QA | OWNER ACTION REQUIRED after real staging is live; no passwords requested |
| 43 | Admin QA | OWNER ACTION REQUIRED after real staging is live |
| 44 | Exact owner action | Identify the existing VPS provider/host and existing staging domain/provider HTTPS URL; grant access through the secure provider/SSH mechanism, not chat. For the existing workflow configure STAGING_HOST, STAGING_USER, STAGING_SSH_KEY in GitHub Actions secret storage. Configure separate runtime variables privately on that host as listed below. |
| 45 | Invited testing blocker | No deployment target/access, isolated staging DB/content/account preparation or real TLS runtime exists. Then owner Student/Admin QA is still required. Disabled payments are NOT the reason. |

## Minimum owner steps to unblock

1. Supply only non-secret provider name, VPS address and the existing staging DNS name (or existing provider HTTPS URL). Do not purchase/invent a domain or send passwords/private keys in chat.
2. In this repository's GitHub Settings → Secrets and variables → Actions, configure STAGING_HOST, STAGING_USER and STAGING_SSH_KEY privately for the existing VPS. Securely grant that user staging-only deployment access. No secrets can be recovered from GitHub by this agent.
3. On that target prepare the reviewed branch/commit under /opt/lms-platform and a private .env.staging using separate DATABASE_URL, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, STAGING_DOMAIN and STAGING_CONTENT_ROOT. Runtime NODE_ENV=production, VYLO_ENVIRONMENT=staging, STORAGE_DRIVER=local, CONTENT_ROOT=/data. No Paymob values. Mail/hosted AI credentials only if owner deliberately enables them, separately from production. Never paste their values into chat.
4. Confirm the target DB and storage are staging-only. Approve an inspected initialization/curriculum-copy procedure that excludes personal accounts/sessions/subscriptions/answers and retains the intended recovered curriculum. The existing blanket seed is NOT approved by this report; no migration/import will run until the exact staging target and safe procedure are verified.

Do not dispatch the manual deployment workflow before target, dataset and environment checks pass. STAGING_ACCESS.md contains the safe validation commands; AUTHENTICATED_QA_CHECKLIST.md remains unchanged because no deployed URL/behavior exists yet.

## Source integrity

SELECT-only audit: 44 modules / 394 lectures / 740 questions.
Module fingerprint fc8b63113c525326f6e92b02d309e3be.
Lecture fingerprint 5fc7d6b1fa1963d086251c501ccf46b1.
Academic period fingerprint e29b20ab8e8a68fb9df2f5ba28f983f8.
Matches previous checkpoint evidence. No source/PDF/curriculum/auth/payment data mutations or service shutdowns.

Local checks include unrelated WIP; they are not proof that a clean remote Docker image at cd783a7 has been built. The remotely deployed exact commit/image must be built and verified when access is supplied. Do not publish local WIP implicitly.

## Final verdict

**B. DEPLOYMENT BLOCKED — OWNER ACTION REQUIRED.**
No real deployment, no guessed URL, no claim of READY, no production deployment, no payments and no branch merge.
