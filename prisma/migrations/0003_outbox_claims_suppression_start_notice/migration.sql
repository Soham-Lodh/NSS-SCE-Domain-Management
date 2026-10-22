-- 0003 — outbox lease/suppression hardening + EVENT_STARTED notifications.
-- All statements are ADDITIVE and safe against a live deployment.

-- New claim state so a worker's terminal transitions can be conditional and so
-- crashed workers' leases are recoverable.
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

-- Business references (already present in payloads, now indexed columns) so a
-- removal/completion/cancellation transaction can atomically suppress every
-- still-pending related message in one bounded statement.
ALTER TABLE "email_outbox" ADD COLUMN "event_id" UUID;
ALTER TABLE "email_outbox" ADD COLUMN "assignment_id" UUID;
ALTER TABLE "email_outbox" ADD COLUMN "claimed_at" TIMESTAMP(3);

-- Backfill from existing payloads so pre-existing queued rows are also
-- suppressible and start-notice aware (bounded columns, set-based update).
UPDATE "email_outbox" SET
    "event_id" = "payload_json"->>'eventId',
    "assignment_id" = "payload_json"->>'assignmentId'
WHERE "payload_json" ? 'eventId' OR "payload_json" ? 'assignmentId';

-- Postgres JSON->TEXT happens to be a valid UUID cast only when the value is a
-- UUID; force the proper cast to stay safe on legacy rows.
UPDATE "email_outbox" SET "event_id" = NULL WHERE "event_id" IS NOT NULL AND "event_id" = '';

CREATE INDEX "email_outbox_assignment_id_status_idx" ON "email_outbox"("assignment_id","status");
CREATE INDEX "email_outbox_event_id_status_idx" ON "email_outbox"("event_id","status");
CREATE INDEX "email_outbox_claimed_at_idx" ON "email_outbox"("claimed_at");

-- One row per logical email in the aggregated email-log view (see section 4E):
-- grouped by outbox_id when present, so an effective-status projection can
-- replace the QUEUED+SENT duplicate display without deleting history.
CREATE INDEX "email_delivery_log_outbox_id_status_idx" ON "email_delivery_log"("outbox_id","status");

-- Reminder scans and start-notice scans are window queries on scheduled events.
CREATE INDEX "event_status_end_at_idx" ON "event"("status","end_at");
