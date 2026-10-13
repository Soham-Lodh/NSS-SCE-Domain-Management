# NSS SCE KIIT — Domain Management Platform

A secure, server-authoritative platform for managing NSS SCE KIIT **domains**,
**volunteers**, **domain leads**, **events**, **event assignments**, completion
tracking, analytics and an append-only **audit trail**.

Built with **Next.js (App Router + TypeScript)** for frontend and backend,
**Supabase Auth (Google OAuth)** for identity, **Supabase PostgreSQL** for data,
**Prisma** as the ORM, and **Brevo SMTP** for transactional email.

> The product/engineering specs in `AI/` are the source of truth:
> `PRD.md`, `SRS.md`, `TRD.md`, `SECURITY_AND_PERFORMANCE_REVIEW.md`,
> `AI_BUILD_PROMPT.md`. The security/normalization addenda in those documents
> supersede earlier simplified descriptions.

---

## 1. Key guarantees

- **No anonymous private access.** Only `/login`, the OAuth callback/error pages
  and public static assets (`/nss-logo.jpg`, hashed JS/CSS) are anonymous.
  Everything else requires an authenticated, authorized session — verified on
  the server, never in the client.
- **Authentication ≠ authorization.** Identity comes from the verified Supabase
  session; **permissions come from current PostgreSQL rows** (role grants), so a
  stale JWT claim can never grant access.
- **Strict domain isolation.** A domain lead can read/mutate only their own
  domain. Oversight roles (tech team, coordinator) can read all domains but
  **cannot** mutate events, assignments or completion.
- **DB-enforced integrity.** Unique `(event, membership)` assignment, unique
  normalized email/roll number/domain name, foreign keys, and a
  `CHECK (end_at > start_at)` constraint.
- **Auditable.** Sensitive mutations write a durable audit row in the same
  transaction. Audit entries never contain secrets or tokens.
- **User-side caching only.** Interactive data is cached in the browser
  (TanStack Query) with short TTLs and central invalidation. There is **no
  shared/cloud cache** dependency — correctness never relies on a remote cache.
- **Premium UI.** Bento-grid layout, restrained skeuomorphic cards/buttons, the
  exact brand palette `#2F3976` / `#E53623` / `#FDFCFF`, accurate skeletons and
  reduced-motion support.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Auth / identity | Supabase Auth (Google OAuth) via `@supabase/ssr` cookie sessions |
| Database | Supabase PostgreSQL |
| ORM | Prisma 6 (`prisma` + `@prisma/client`) |
| Email | Brevo SMTP via `nodemailer`, durable outbox with retry/backoff |
| Client cache | TanStack Query v5 (user-side, TTL + invalidation) |
| Validation | Zod |
| Styling | Tailwind CSS 3 + brand design tokens |
| Tests | Vitest |

---

## 3. Roles & permissions (enforced server-side)

| Capability | Volunteer | Domain Lead | Tech Team | Coordinator |
|---|:--:|:--:|:--:|:--:|
| Sign in (allowlisted Google) | ✅ | ✅ | ✅ | ✅ |
| View own profile/assignments | ✅ | ✅ | ✅ | ✅ |
| View all domains / volunteers / events | — | own domain | ✅ | ✅ |
| Create/edit events | — | own domain | — | — |
| Assign / remove / reassign volunteers | — | own domain | — | — |
| Mark assignment complete | — | own domain | — | — |
| Manage volunteer master records | — | — | ✅ | ✅ |
| Assign domain leads | — | — | ✅ | ✅ |
| Add/remove tech team | — | — | ✅ | ✅ |
| Add/remove coordinators | — | — | — | ✅ |
| View audit logs | — | — | ✅ | ✅ |
| View **tech-team** activity in audit | — | — | — | ✅ |

Additional rules: a user cannot change their own role; the **last active
coordinator cannot be removed or demoted**; hiding a button is never the
security boundary — the same policy runs on every server request.

All of this lives in [`src/lib/authorization/roles.ts`](src/lib/authorization/roles.ts)
(pure, unit-tested) and [`src/lib/authorization/require.ts`](src/lib/authorization/require.ts)
(server guards).

---

## 4. Local setup

> Do **not** use `prisma db push`. Use reviewed migrations (below).

### Prerequisites
- Node.js ≥ 20 (LTS) and npm.
- A Supabase project (PostgreSQL + Google OAuth configured).
- A Brevo SMTP account with a verified sender.

### Steps

```bash
# 1. Install (this repo uses npm)
npm install

# 2. Configuration — copy the template and fill in real values
cp .env.example .env.local

# 3. Generate the Prisma client
npm run prisma:generate

# 4. Apply migrations against your DATABASE_URL/DIRECT_URL
npm run prisma:migrate        # dev: creates & applies prisma/migrations
# ...or, in CI/CD: npm run prisma:deploy

# 5. (Optional) local fictional seed — never run against production
npm run db:seed

# 6. Run
npm run dev                   # http://localhost:3000
```

### Environment variables
All names are in [`.env.example`](.env.example). Highlights:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase
  URL + **publishable/anon** key (safe for the browser; **never** the
  service-role key).
- `DATABASE_URL` — **runtime** pooled connection (Supabase transaction pooler,
  `:6543`, `?pgbouncer=true&connection_limit=1`).
- `DIRECT_URL` — **migrations/CLI** direct connection (`:5432`).
- `ALLOWED_EMAIL_DOMAINS` — exact, comma-separated institutional suffixes
  (e.g. `kiit.ac.in`). **Confirm the canonical KIIT suffix with the project
  owner.** Matching is exact-suffix (sub-domains allowed), never substring.
- `BOOTSTRAP_COORDINATOR_EMAIL` — optional; grants the **first** coordinator
  only when no active coordinator exists (break-glass for an empty database).
- `BREVO_SMTP_*`, `MAIL_FROM`, `MAIL_FROM_NAME` — Brevo transactional email.
- `APP_URL`, `ALLOWED_ORIGINS` — origin allowlist for CSRF checks on mutations.
- `CRON_SECRET` — bearer secret for the outbox worker endpoint.
- `ORGANIZATION_TIMEZONE` — display timezone (default `Asia/Kolkata`).

### Supabase Google OAuth
1. Supabase → **Authentication → Providers → Google**: add your Google OAuth
   client ID/secret.
2. Add redirect URLs (exact, per environment — no wildcards in production):
   - Local: `http://localhost:3000/auth/callback`
   - Prod: `https://<your-domain>/auth/callback`
   Configure the same URLs in Google Cloud Console → *Authorized redirect URIs*
   as `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Set the Supabase **Site URL** and **Redirect allow list** for each env.
4. The app uses the **PKCE** flow via the `@supabase/ssr` cookie integration;
   the callback exchanges the code with `exchangeCodeForSession`.

### Onboarding policy
A verified, allowlisted first-time user is provisioned as a **Volunteer**
(least privilege) automatically — administrative roles are never auto-granted.
The optional bootstrap email grants the *first* coordinator on an empty
database only.

### NSS logo
Place the approved file at **`public/nss-logo.jpg`**; it is served at
`/nss-logo.jpg`. Dimensions are reserved (no layout shift). If the file is
absent the app shows a neutral monogram fallback — no logo is ever fabricated.
See [`src/components/brand/nss-logo.tsx`](src/components/brand/nss-logo.tsx).

---

## 5. Architecture

```
Browser (React 19, TanStack Query user-side cache)
   │  fetch /api/*  (same-origin cookies, x-request-id)
   ▼
Next.js server (App Router)
   ├── middleware.ts            → session refresh + early redirect (UX guard only)
   ├── Route Handlers           → auth → authorize → validate → service → audit → respond
   ├── Services (business logic)
   │     volunteer / event / assignment / user-admin / analytics / audit / domain
   ├── lib/auth/session.ts      → verified identity → DB-backed AuthContext
   ├── lib/authorization/*      → central policy (roles + domain scope)
   ├── lib/db/prisma.ts         → single PrismaClient (pooled DATABASE_URL)
   ├── lib/audit/write-audit.ts → transactional, append-only audit
   └── lib/email/*              → Brevo SMTP + durable outbox (retry/backoff)
   ▼
Supabase PostgreSQL (Supabase Auth for identity)
```

Directory map:

```
src/
  app/                 routes (pages + /api route handlers + /auth)
  components/          ui primitives, layout shell, dashboard panels, brand
  hooks/api-hooks.ts   TanStack Query queries + mutations (invalidation)
  lib/
    auth/              session resolution, types
    authorization/     roles (pure matrix), require (server guards), email
    cache/             query-keys (user-side), memory (reference data only)
    db/                prisma singleton
    audit/             audit writer
    email/             brevo + outbox
    validation/        zod schemas
    api/               response envelope + route wrapper + parsers
    observability/     redacting structured logger
  services/            business logic
prisma/                schema, migrations, seed
tests/                 unit tests
```

---

## 6. Data model (normalized — `prisma/schema.prisma`)

`Person` · `AppUser` (links Supabase auth id) · `Domain` · `Project` ·
`VolunteerMembership` (relational, historical) · `RoleGrant` (relational, no
comma-separated roles) · `Event` · `EventAssignment` (one current-state row per
event/membership → at most one credit) · `AssignmentHistory` (append-only) ·
`AuditLog` · `EmailOutbox`.

Design notes:
- **Event category is derived** (`UPCOMING`/`ONGOING`/`PAST`) from timestamps;
  only `SCHEDULED`/`CANCELLED`/`ARCHIVED` are persisted.
- **Completion is explicit** per assignment — a past event does **not**
  auto-complete anyone.
- **Removal is soft** (`removedAt`); re-adding reactivates the same row, so no
  duplicate credit and history is preserved.
- Unique constraints enforce one email, roll number, domain name, and
  `(event, volunteer_membership)` pair.

### Migrations & safety
- Migration: [`prisma/migrations/0001_init/migration.sql`](prisma/migrations/0001_init/migration.sql)
  (generated with `prisma migrate diff --from-empty`), plus reviewed SQL that
  adds the `end_at > start_at` CHECK and partial unique indexes for
  one-active-membership-per-domain and one-active-grant-per-scope.
- **Before applying to a non-empty database:** back up first, inspect the diff
  for data loss/locks, and rehearse on staging.
- Rollback guidance: app rollback does **not** reverse a migration — use
  expand/migrate/contract for risky changes. See [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 7. Caching (user-side only)

The **browser query cache** (TanStack Query) is the caching layer. There is no
Redis or other cloud cache.

- Keys are centralized and **scoped** by domain + filters + pagination
  ([`src/lib/cache/query-keys.ts`](src/lib/cache/query-keys.ts)).
- TTLs are short and explicit (`me` 60s, lists 20s, analytics 30s, audit 15s,
  domains 5min) via `staleTime`; `gcTime` bounds memory so no dead cache grows.
- **Mutations invalidate** exactly the affected key prefixes
  (`invalidate()` in [`src/hooks/api-hooks.ts`](src/hooks/api-hooks.ts)) — after
  volunteer, event, assignment, completion, role and domain changes.
- Auth/permission errors are **never retried**, avoiding call storms.
- The only server-side memo is a short-TTL, explicitly-invalidated cache for the
  static active-domain list ([`src/lib/cache/memory.ts`](src/lib/cache/memory.ts)),
  which always falls back to the database and is documented as per-instance.
- Server responses are always `Cache-Control: private, no-store`; personalized
  data is never publicly cached.

---

## 8. Performance & bottleneck mitigations

- **No N+1 for completion counts:** the member list is **one grouped SQL query**
  with `COUNT(*) OVER()` for the total
  ([`src/services/volunteer-service.ts`](src/services/volunteer-service.ts)).
- Event cards use two bounded queries per page (events + grouped counts).
- Bounded pagination everywhere (default 25, max 100) with stable sort orders.
- Oversight analytics fan out with **bounded concurrency** (batches of 5).
- Single PrismaClient per runtime; runtime uses the pooler connection.
- Validation via Zod at every boundary; mutation origin/CSRF checks.
- `select`-only DTOs; no over-fetching.

---

## 9. Audit & observability

- **Business audit** (append-only `AuditLog`): actor, action, target, domain,
  outcome, `requestId`, allowlisted before/after. Written **inside** the same
  transaction as the change.
- **Operational telemetry**: redacting structured logger
  ([`src/lib/observability/logger.ts`](src/lib/observability/logger.ts)) — never
  logs cookies, JWTs, auth headers or SMTP credentials.
- Authorization denials are recorded with a request id and **without leaking
  whether a cross-domain record exists**.
- Logout auditing is **best-effort** (browser close/expiry can't be observed).

---

## 9b. Reminders, event lifecycle, Excel import/export, people

### Automated event emails (no manual sending, no login required for recipients)
All emails are queued in a transactional outbox and delivered by the cron
workers below — there is **no manual emailing step**. Templates follow the web
app's UI flow (event name, domain, start, deadline, location, description,
assigner) and contain **no login URLs**: the email itself is the notification.

- **Assignment notice** (`EVENT_ASSIGNED`) — queued in the same transaction as
  the assignment and delivered **immediately after commit** (not deferred to the
  event start time). Includes who assigned it, the event details and all deadlines.
- **Monthly task digest** (`MONTHLY_DIGEST`) — one consolidated email per member
  at the **start of each month** (organization timezone, 3-day grace window so a
  missed scheduler run still delivers) listing every still-open assignment:
  future tasks and overdue-but-open tasks, nearest deadline first. Completed or
  removed assignments and ended events are excluded; a member with no open
  tasks gets no email. Idempotent per (recipient, month) — concurrent or
  retried runs never duplicate.
- **Deadline reminders** — **4 days**, **24 hours** and **1 hour** before an
  event's deadline (`endAt`), delivered only while the event is still
  `SCHEDULED` and the member is still assigned.
- **Suppression** — if a domain lead completed/ended/cancelled the event, or
  removed the member (or completed the assignment) **before delivery**, the
  email is never sent: the outbox marks it `DEAD` and writes an
  `EMAIL_SUPPRESSED` audit row. Every delivery writes `EMAIL_SENT` /
  `EMAIL_DELIVERY_FAILED` audit rows, visible to **tech team and coordinators**.

Reminders are idempotent (per-event `reminder_*_sent_at` stamps + a unique
outbox idempotency key), so each person is reminded at most once per stage.
Trigger the reminder producer from your scheduler:

```http
POST /api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

### Event (task) lifecycle — never auto-ended
Reaching a deadline does **not** end a task: a past event stays open under the
“Past (open)” tab. **Only a domain lead** can end it (`POST /api/events/:id/lifecycle`
with `{"action":"complete"}`), and if it was ended by mistake the same endpoint
with `{"action":"reopen"}` reactivates it. Both are audited. Reminders stop
while an event is ended.

### Volunteer import (Excel, two-phase)
Header row expected: **Email Address, Name, Roll No, Year, Gender, Domain, Project**.

- `POST /api/volunteers/import` (multipart) parses and **validates only** —
  nothing is written — and returns a per-row preview (`valid` / `invalid` /
  `duplicate` with a reason).
- `POST /api/volunteers/import/commit` re-validates every row server-side and
  inserts only valid rows in a transaction.

Rules enforced: email must end with an allowed domain; the **Domain must match
an existing domain**; a provided project must exist in that domain; duplicates
(in-file and in-DB) are skipped, so no redundant rows are created. The UI shows
a confirmation preview before you commit.

### Excel export / Copy-as-CSV
- `GET /api/export/volunteers?domainId=` — workbook with **Report** (domain name
  + totals), **Members** and **Assignments** (volunteer × event details).
- `GET /api/export/domain-report?domainId=` — workbook with **Report** (domain
  name at top, total/upcoming/ongoing/past/completed/cancelled event counts) and
  **Events**.
- `GET /api/export/csv?domainId=&dataset=members|assignments|domain-events` —
  one flat RFC 4180 table per dataset, used by the **Copy CSV** buttons on the
  volunteers page (paste straight into Google Sheets). Cell values starting
  with `=` `+` `-` `@` Tab or CR are neutralized against formula injection;
  scope rules match the Excel exports exactly (domain lead → own domain,
  oversight → any domain), and responses are `private, no-store`.

Domain lead → own domain; oversight roles → any domain.

### People administration
`POST /api/admin/people` adds a person by **name + email + role** (domain
required for domain leads; optional for volunteers, which also creates their
membership). If the account already exists the role is applied immediately via
the normal hierarchy checks; otherwise a **pending role assignment** is stored
and applied at the person's first sign-in. `DELETE /api/admin/people/:id?kind=user|pending`
deactivates a user (retaining history) or revokes an invitation.

### Scheduled jobs summary
Both `GET` (platform schedulers such as Vercel Cron) and `POST` (external
schedulers) are accepted on each endpoint. Missing `CRON_SECRET` fails closed
(503); a wrong secret is 401.

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET/POST /api/cron/outbox` | deliver queued emails (retry/backoff, deferral + suppression) — run **every minute** so assignment notices and the 1-hour reminder are timely | `Bearer CRON_SECRET` |
| `GET/POST /api/cron/reminders` | 4-day / 24-hour / 1-hour deadline reminders + monthly digest producer — run every 5–15 minutes | `Bearer CRON_SECRET` |

Reminder stages that were missed entirely (scheduler down longer than the
stage tolerance: 12h for the 4-day, 3h for the 24-hour, 10 min for the 1-hour
stage) are recorded as `REMINDER_MISSED_*` audit rows and **not** sent in a
stale burst; later stages still fire on time.

### Email delivery logs (tech team & coordinator only)
Every queue, send, failure attempt, suppression and dead-letter outcome is
written to an append-only `EmailDeliveryLog` table and surfaced at
`/dashboard/email-logs` (nav: **Email Logs**), filterable by recipient, type and
status. The API (`GET /api/email-logs`) enforces TECH_TEAM/COORDINATOR
server-side — domain leads receive 403 even with a manually typed URL.

> `CRON_SECRET` is required for these. To create the **first coordinator** on an
> empty database, set `BOOTSTRAP_COORDINATOR_EMAIL` to that person's email before
> their first sign-in (they are granted Coordinator instead of Volunteer).

Run `npx tsx scripts/verify-setup.ts` to check env, DB, Supabase and SMTP.

---

## 10. Testing

```bash
npm run typecheck     # strict TypeScript, no emit
npm run lint          # eslint (next core-web-vitals)
npm test              # vitest unit tests
npm run build         # production build
```

Current suite (runs without a database): **31 tests** covering the
role/permission matrix (including "tech team cannot remove coordinators"),
exact email-domain allowlisting (including the empty-local-part and lookalike
attacks), derived event categories/boundaries, and user-side cache key scoping +
invalidation coverage.

> Integration/E2E tests (real DB transactions, OAuth callback, cross-domain 403s,
> concurrent duplicate assignment, SMTP outage) require a configured Supabase
> project and are not included as automated tests here — see the release test
> matrix in `AI/SECURITY_AND_PERFORMANCE_REVIEW.md` §7.

---

## 10b. Troubleshooting

- **“The page has no CSS / looks unstyled”** — almost always a stale `.next`
  build directory. Never run `npm run build` while `npm run dev` is running (the
  build overwrites `.next` and the dev server then serves a broken CSS path).
  Stop the dev server, delete `.next`, and restart `npm run dev`.
- **Reminders/outbox do nothing** — `CRON_SECRET` must be set and the cron
  endpoints scheduled.
- **Nobody can manage roles** — set `BOOTSTRAP_COORDINATOR_EMAIL` before the
  first sign-in so the first coordinator is created.

## 11. Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full pre-production checklist,
build/deploy steps, scheduled outbox worker, caching rules, backups/restore,
monitoring and rollback.

---

## 12. Package scripts

Verified in `package.json`: `dev`, `build`, `start`, `lint`, `typecheck`,
`test`, `test:watch`, `prisma:generate`, `prisma:validate`, `prisma:migrate`,
`prisma:deploy`, `prisma:studio`, `db:seed`.

---

## 13. Unresolved product decisions (owner confirmation required)

1. Canonical KIIT email suffix(es) and any exceptions.
2. Whether a lead may hold multiple domains/roles (v1 = one operational role).
3. Whether volunteer email/roll number are globally unique (assumed yes).
4. Definition of "completed" (v1 = domain-lead self-certification).
5. Audit retention period and who may export.
6. Whether emails are sent on every role/assignment change.
