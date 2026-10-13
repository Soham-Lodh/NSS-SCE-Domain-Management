# Route Permission Matrix

All private API routes require a verified Supabase user, an active `AppUser`, and current active role grants from PostgreSQL unless noted. Standard API JSON responses set `Cache-Control: private, no-store, max-age=0`; export and cron responses also set no-store. Browser mutations call `assertSameOrigin`.

| Route | Methods | Roles | Domain Rule | Validation / Audit |
|---|---:|---|---|---|
| `/api/me` | GET | Authenticated active user | Own account only | No mutation |
| `/api/domains` | GET | Authenticated | Domain leads see own visible domain; oversight sees all visible domains | No mutation |
| `/api/domains` | POST | TECH_TEAM, COORDINATOR | Global oversight | `domainCreateSchema`; audit in service |
| `/api/analytics/overview` | GET | DOMAIN_LEAD for `scope=domain`; TECH_TEAM/COORDINATOR for `scope=all` | Domain lead locked to own domain; oversight may request any domain or all | Query schema |
| `/api/volunteers` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain lead locked to own domain; oversight must supply/select a domain | `volunteerListQuery` + pagination |
| `/api/volunteers` | POST | TECH_TEAM, COORDINATOR | Body domain must exist; service writes domain membership | `createVolunteerSchema`; volunteer audit; outbox |
| `/api/volunteers/[id]` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain lead locked to own domain; oversight can resolve membership domain by id | UUID param |
| `/api/volunteers/[id]` | PATCH | TECH_TEAM, COORDINATOR | Oversight only; membership domain resolved server-side | `updateVolunteerSchema`; volunteer audit; outbox on deactivate |
| `/api/volunteers/[id]/history` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Same as volunteer detail | UUID param |
| `/api/volunteers/import` | POST | TECH_TEAM, COORDINATOR | Rows are validated against known domains/projects | Multipart file; preview only |
| `/api/volunteers/import/commit` | POST | TECH_TEAM, COORDINATOR | Revalidates all rows server-side | `importCommitSchema`; service audit where applicable |
| `/api/export/volunteers` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain lead own domain; oversight requested/resolved domain | Query schema; formula-safe export service |
| `/api/export/domain-report` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain lead own domain; oversight requested/resolved domain | Query schema; formula-safe export service |
| `/api/events` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain lead own domain; oversight requested domain | `eventListQuery` + pagination |
| `/api/events` | POST | DOMAIN_LEAD only | Must be own domain | `createEventSchema`; event audit |
| `/api/events/[id]` | GET | DOMAIN_LEAD, TECH_TEAM, COORDINATOR | Domain-scoped event lookup | UUID param |
| `/api/events/[id]` | PATCH | DOMAIN_LEAD only | Must be own domain | `updateEventSchema`; event audit |
| `/api/events/[id]/assignments` | POST | DOMAIN_LEAD only | Event and memberships must be in own domain | `bulkAssignSchema`; assignment history; audit; outbox |
| `/api/events/[id]/lifecycle` | POST | DOMAIN_LEAD only | Must be own domain | Lifecycle action schema; audit; outbox on complete |
| `/api/assignments/[id]` | PATCH | DOMAIN_LEAD only | Assignment event must be in own domain | `assignmentActionSchema`; history; audit |
| `/api/users` | GET | TECH_TEAM, COORDINATOR | Global user directory | Search + pagination |
| `/api/users/[id]/role` | POST | Role hierarchy enforced in service | No self-change; last coordinator protected; domain required for domain lead | `roleChangeSchema`; role audit; outbox |
| `/api/admin/people` | GET | TECH_TEAM, COORDINATOR | Pending role assignments | No mutation |
| `/api/admin/people` | POST | TECH_TEAM, COORDINATOR | Domain required for domain lead | `personUpsertSchema`; people/role audit; outbox |
| `/api/admin/people/[id]` | DELETE | TECH_TEAM, COORDINATOR | Service enforces hierarchy/self/last coordinator rules | UUID + `kind`; audit |
| `/api/audit-logs` | GET | TECH_TEAM, COORDINATOR | Oversight may filter by domain; coordinator-only visibility for tech-team activity is handled in service policy if present | `auditListQuery` + pagination |
| `/api/auth/logout` | POST | Authenticated best effort | Own session | Same-origin; logout audit best effort |
| `/api/cron/outbox` | POST | Bearer `CRON_SECRET` | System worker | Processes pending outbox: defers until event start, suppresses completed/removed, audits every send |
| `/api/cron/reminders` | POST | Bearer `CRON_SECRET` | System worker | Queues 4-day/24-hour/1-hour reminders before `endAt` |

## Protected Pages

`/dashboard` and all `/dashboard/**` routes are protected by the dashboard layout. Anonymous users are redirected through the login flow. Page controls are role-aware for usability only; APIs remain the security boundary.
