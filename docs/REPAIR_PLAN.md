# Repair Plan And Findings

Last updated: 2026-10-13

## Baseline

- `npm run prisma:validate`: passed. Prisma warns that `package.json#prisma` is deprecated for Prisma 7.
- `npm run prisma:generate`: passed after Node processes were not holding Prisma engine files.
- `npm run typecheck`: passed before and after the repair.
- `npm run lint`: passed before and after the repair. `next lint` is deprecated for Next.js 16.
- `npm test`: passed, 32 unit tests.
- `npm run build`: passed.

## Confirmed Defects Fixed

### P0: Volunteer list SQL column mismatch

`src/services/volunteer-service.ts` used snake_case identifiers for the `person` table (`p.full_name`, `p.email_normalized`, `p.roll_number_normalized`) even though the Prisma model maps those physical columns as quoted camelCase (`"fullName"`, `"emailNormalized"`, `"rollNumberNormalized"`). This caused PostgreSQL `42703` and `/api/volunteers` 500s.

Fixed by quoting the real identifiers in the raw SQL and aliasing result columns to the TypeScript DTO shape.

### P0: No-domain volunteer query from oversight UI

The volunteer page rendered an initial `/api/volunteers` request without a domain for tech-team/coordinator users. The API correctly requires a domain for a domain-scoped list, so this produced a noisy 403 before the user selected a domain.

Fixed by disabling the TanStack Query until `domainId` is available. The page already shows a "Select a domain" empty state.

### P1: Oversight volunteer detail/history route mismatch

Oversight users could open a member from a domain-scoped list, but `/api/volunteers/[id]` and `/api/volunteers/[id]/history` received only the membership id and re-ran domain-scope resolution without a domain. That could return 403 even though the row was legitimately reachable from the list.

Fixed by resolving the membership's domain server-side for oversight roles when no `domainId` query parameter is supplied. Domain leads still resolve to their own domain and cannot cross domains.

### P1: Removed assignment re-add did not reactivate

Bulk assignment reported a removed event/membership pair as newly assigned, but the database unique constraint could skip creation and leave the old row `removedAt`, so the assignment stayed inactive.

Fixed by detecting removed existing assignments, reactivating them, resetting assignment state to `ASSIGNED`, and writing assignment history. This preserves the single-row/one-credit invariant.

### P1: Duplicate outbox idempotency could fail business transactions

Several email enqueue paths use unique idempotency keys. Retried idempotent business actions could encounter Prisma `P2002` on the outbox row and fail the surrounding business transaction even though the desired email was already queued.

Fixed by treating a duplicate idempotency key in `enqueueEmail` as success.

## Environment / Runbook Finding

The pasted `.next` manifest/cache errors and Prisma Windows DLL `EPERM` are consistent with multiple Node/Next processes or deleting/generating build artifacts while another process is using them.

Safe Windows cleanup:

1. Stop every `next dev`, `next start`, Prisma Studio, and test watcher process.
2. If needed, run `taskkill /F /IM node.exe` only after confirming no unrelated Node work should keep running.
3. Remove `.next` and, only for Prisma engine lock issues, `node_modules/.prisma`.
4. Run `npm run prisma:generate`.
5. Start exactly one `npm run dev` process in this worktree.
6. Do not run `next build` and `next dev` concurrently against the same `.next` directory.

## Remaining Risks / Next Work

- There are no integration tests wired to a disposable test database yet, so DB-backed concurrency claims still need automated coverage.
- Outbox processing still reads pending rows before sending; true multi-worker "claim before send" needs a schema-supported lease/processing state or a PostgreSQL `FOR UPDATE SKIP LOCKED` claim path.
- Route-level authorization has unit coverage for the pure role matrix, but not every API route is exercised as every role.
- Performance measurements in the pasted logs are from a remote Supabase pooler plus cold Next compilation. Warm endpoint p95 should be measured in staging with request/query timing.
