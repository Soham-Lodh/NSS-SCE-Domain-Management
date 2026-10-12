# Deployment & Operations Guide

NSS SCE KIIT — Domain Management Platform

This guide covers production hardening, deploy steps, scheduled jobs, caching
rules, monitoring, backups and rollback. Read alongside `README.md`.

---

## 1. Pre-production checklist

- [ ] Create a **separate Supabase project/environment** for staging; never
      point previews at production data.
- [ ] Configure production **Google OAuth** callback/redirect URLs (exact, no
      wildcards): `https://<domain>/auth/callback`.
- [ ] Set the confirmed **`ALLOWED_EMAIL_DOMAINS`** (exact suffixes).
- [ ] Configure **Brevo SMTP** with a verified sender; store credentials in the
      platform secret manager (never in the repo or `NEXT_PUBLIC_*`).
- [ ] Add all environment variables to the hosting provider
      (production **and** preview), including `CRON_SECRET`.
- [ ] Set `APP_URL` to the production origin and `ALLOWED_ORIGINS` if the app is
      served from additional origins.
- [ ] Confirm **runtime DB pool sizing**: `DATABASE_URL` uses the Supabase
      transaction pooler; keep `connection_limit=1` per serverless function and
      budget total connections across all instances.
- [ ] Verify every authenticated page/API opts out of shared caching
      (private/no-store) — see §5.
- [ ] Rehearse the migration against **staging**, confirm a backup exists, and
      review the SQL for destructive operations/locks.
- [ ] Create one test account per role and **two domains** for smoke tests.
- [ ] Configure monitoring/alerts (see §7).

---

## 2. Build & deploy

CI should run, in order:

```bash
npm ci
npm run prisma:generate
npm run typecheck
npm run lint
npm test
npm run build
```

Then apply migrations and deploy:

```bash
npm run prisma:deploy     # uses DIRECT_URL / migration connection
# deploy the Next.js app (Node-compatible host / Vercel) with server env vars
```

Recommended host: any **Node.js-compatible** platform (e.g. Vercel, or a
container). The app requires a Node server runtime (Route Handlers, middleware,
Prisma) — it is not a static export.

Notes:
- `next build` output must run with `npm run start` (or the platform's Next
  runtime). Do not upload `.next` to a plain static host.
- Keep `NEXT_PUBLIC_*` values free of secrets — they are embedded in the client
  bundle.

---

## 3. Scheduled jobs

The transactional email **outbox worker** is an HTTP endpoint:

```http
POST /api/cron/outbox
Authorization: Bearer <CRON_SECRET>
```

Schedule it (e.g. every 1 minute) using your platform's cron (Vercel Cron,
GitHub Actions, or an external scheduler). Each run delivers up to 25 pending
messages with exponential backoff and marks unrecoverable ones `DEAD` after 5
attempts.

Business mutations commit **first**; email is queued in the same transaction and
delivered afterwards. **SMTP failure never rolls back committed work.**

---

## 4. Database migrations & rollback

- Migrations live in `prisma/migrations/`. Use `prisma migrate deploy` in CD;
  `prisma migrate dev` only locally.
- **Never** run `prisma db push` against a database that holds data.
- Before a risky change: take a backup, check for table rewrites, long locks and
  backfills, and prefer **expand → migrate → contract** so old and new app
  versions can run during rollout.
- Application rollback does **not** reverse a migration. To recover:
  1. Roll the app back to the previous build if the schema is still compatible.
  2. For an incompatible migration, restore from backup or ship a forward-fix
     migration.
- Restore procedure: use Supabase's point-in-time recovery / `pg_dump` restore
  into a staging database first, verify row counts and key constraints, then
  promote.

---

## 5. Caching rules (must hold in production)

- Personalized HTML, RSC payloads and API responses must be **private/no-store**.
  The app sets this via `next.config.mjs` headers and per-response headers.
  Verify the deployed host honours them (inspect `Cache-Control` on a real
  authenticated request, and confirm no CDN rule caches `/api/*` or `/dashboard/*`).
- Do **not** use Next.js static generation/ISR/shared data cache for any private
  route. All private routes are dynamic (`force-dynamic`).
- There is **no shared/cloud cache**. The user-side TanStack Query cache is
  per-browser and holds no authorization decisions — every request is
  re-authorized on the server.
- If you ever add a shared cache, it must be scoped by user/domain, invalidated
  centrally, and never be the sole source of permission decisions.

---

## 6. Secrets management

- Store secrets in the platform's secret store; never commit `.env*`.
- Rotate immediately if a secret leaks; investigate access history.
- Keep the Supabase **service-role** key server-only and out of
  `NEXT_PUBLIC_*`. The app does not need it for routine requests.
- Brevo SMTP credentials are server-only and are never logged.

---

## 7. Monitoring & alerting

Alert on:
- rising 5xx rate and unhandled route errors,
- authentication failures / OAuth exchange failures,
- authorization **denials** and suspected cross-domain probes,
- DB query latency and connection-pool saturation,
- email outbox backlog / delivery failures / `DEAD` messages,
- migration failures.

Keep three streams separate: **business audit** (durable `AuditLog`),
**security events**, and **operational telemetry** (structured, redacted logs
with request/correlation ids). Never log cookies, JWTs, auth headers, full
request bodies or SMTP credentials.

---

## 8. Post-deploy smoke test

1. Anonymous: `/dashboard` → redirect to `/login`; `/api/me` → `401` (no bytes).
2. Sign in with an allowlisted account → lands on `/dashboard`; a disallowed
   domain is rejected.
3. Domain lead: create event → assign members (bulk) → mark complete → member
   counts update → reassignment preserves history.
4. Domain lead A cannot fetch Domain B member/event ids (consistent denial).
5. Tech team **cannot** remove/demote a coordinator; coordinator can.
6. `/api/audit-logs` shows the actions above; volunteers/domain leads get `403`.
7. Confirm a mutation queues an outbox row and the worker delivers it.
8. Confirm `/nss-logo.jpg` loads and the bento layout stacks on mobile.
9. Confirm private responses carry `Cache-Control: private, no-store`.

---

## 9. Environments & branches

- Keep **development**, **preview/staging** and **production** isolated
  (separate Supabase projects or an explicitly isolated schema), with their own
  OAuth callbacks, email domains and secrets.
- Never seed production with privileged accounts or real volunteer data.
