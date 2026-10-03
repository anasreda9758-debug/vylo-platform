# VYLO limited staging access

Prepared 2026-10-03, Africa/Cairo. **Configuration only; not deployed or runtime-certified.** Owner confirmed no external deployment exists. No CDN purge is applicable yet.

## Existing architecture and prepared changes

Reuse the existing VPS, Docker, Next.js standalone runner and PostgreSQL stack. Add Caddy only as its TLS reverse proxy; do not introduce another hosting platform. Preserve Compose project `lms-platform-staging` and existing `pgdata`/`backups` identities.

Only Caddy publishes 80/443. Next.js 3000 and PostgreSQL 5432 are not published. PostgreSQL uses an internal Docker network. The app uses a production build, a separate staging environment and a read-only approved-content mount. No migration or seed runs on startup. The optional Docker seed target is not selected by Compose.

Caddy's automatic HTTPS issues/renews certificates and redirects HTTP; DNS and reachable 80/443 plus persistent certificate storage are prerequisites. See [automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). There is no static content server or cache at this proxy: PDFs still traverse the authorized Next.js routes.

Production Better Auth already sets Secure, HttpOnly and SameSite=Lax. The validator requires an exact HTTPS `BETTER_AUTH_URL` matching `STAGING_DOMAIN`; Compose uses that origin for trusted origins. The proxy fixes the forwarded host/protocol. Existing Next headers retain nosniff, DENY clickjacking protection, referrer/permissions policies and production HSTS. Caddy adds HSTS at the HTTPS edge. No speculative strict CSP was added; feature-specific CSP remains separate work.

## Owner actions before deploying

1. Select an isolated staging VPS/domain and point its DNS at the host. Restrict invited access using the host's existing controls. Do not expose the local Windows development server or database.
2. Confirm the checked-out branch/commit on the VPS contains this remediation. Review the Docker build artifact: local Next build passed with nine existing broad-filesystem-tracing warnings; Docker/Caddy are unavailable locally, so the actual image has NOT been built or inspected here. No production image certification is claimed.
3. Take a DB checkpoint first. Prepare the existing-schema staging database and approved content through a separately approved operator procedure. **Do not run historical migrations, reset/seed scripts, copy shared-password fixture accounts, or blindly restore local user data.** Check the recovered baseline separately: 44 modules, 394 lectures, 740 questions. If different, stop and investigate. Use a least-privilege application DB role before wider/public rollout; this task creates no roles.
4. Keep the existing volume identity and inspect its actual PostgreSQL data layout before starting. PGDATA points to the existing intended `/var/lib/postgresql/data` mount. Never replace a populated volume or use `down -v`. The Docker engine can initialize an empty volume; therefore the owner must verify the correct populated volume/database first—this task does not provision or initialize one.
5. Copy the example into an untracked `.env.staging` on that host and supply separate values privately. Required names: `STAGING_DOMAIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STAGING_CONTENT_ROOT`, `NODE_ENV=production`, `VYLO_ENVIRONMENT=staging`, `STORAGE_DRIVER=local`, `CONTENT_ROOT=/data`. Example placeholders are intentionally rejected. Do not paste secrets into logs, issues, commits or this checklist.
6. Hosted AI defaults off. If specifically enabled, use a separate staging `GROQ_API_KEY` and `USE_HOSTED_AI=true`; keep the shared atomic 15/day policy. Configure separate mail credentials only if needed. No Paymob variables are allowed. Do not forward production webhooks or configure payment keys.
7. On the prepared host, run these checks (no DB changes):
   ```sh
   node --env-file=.env.staging scripts/validate-staging-env.mjs
   docker compose --env-file .env.staging -f docker-compose.staging.yml config --quiet
   ```
   Never print expanded Compose configuration containing secrets. Validate the Caddyfile with Caddy on that host using the private environment before first startup.
8. Only after steps 1–7 pass, the owner may use the manual deployment workflow or the existing Compose startup command. It now stops on preflight errors, is manual-only, and never runs automatic migrations/seeds. Ensure the remote checkout is the reviewed security commit before dispatching.
9. Verify real TLS, HTTP-to-HTTPS redirect, `/api/health`, secure cookie flags, exact auth callback origin, app/database ports unreachable externally, and protected PDF private/no-store. Verify there is no CDN cache or public object/static PDF alternative. Complete `AUTHENTICATED_QA_CHECKLIST.md` with legitimate isolated accounts.

## Operational boundaries

- No actual domain, certificate, secret, dataset, account, subscription or deployment was created/changed here.
- Validator is fail-closed for unsafe origins, missing secrets, wrong DB host/database, unsupported storage and payment keys; it cannot establish real DNS, DB schema compatibility or absence of fixture users.
- Backups preserve files; retention/restore verification needs owner operation. No automated destructive cleanup was added.
- Do not enable unreviewed OSPE, dormant payment endpoints or shared-password test users for invited testers.
- Payments being disabled is intentional, not a reason to reject invited testing.
- If a CDN is added later, explicitly bypass protected content and verify caching at that edge. No existing external cache currently needs purging.
