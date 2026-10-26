-- Reviewed migration 0005: composite index for the deadline-reminder scan.
--
-- Every scheduler minute, the reminder service runs one scan over
-- (status = 'SCHEDULED', end_at in (now, now + 4 days]). Previously that scan
-- walked the (domain_id, end_at) index or the table; this composite index lets
-- PostgreSQL seek directly to the eligible range and halves the work compared
-- with the three previously overlapping per-stage queries.
--
-- Additive only: no data changes. NOTE: Prisma runs each migration inside a
-- transaction, so CONCURRENTLY is deliberately not used here; the table is
-- small (one row per event) and the build is instant. Rollback is simply
-- `DROP INDEX IF EXISTS "events_status_end_at_idx";`

CREATE INDEX IF NOT EXISTS "events_status_end_at_idx"
  ON "events" ("status", "end_at");
