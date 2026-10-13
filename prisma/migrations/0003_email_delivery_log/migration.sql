-- Add email delivery audit table (tech team / coordinator observability).
-- Append-only: one row per queue/attempt outcome. Retries create new rows.

CREATE TYPE "EmailDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'DEAD', 'SUPPRESSED');

CREATE TABLE "email_delivery_log" (
    "id"                  UUID NOT NULL,
    "outbox_id"           UUID,
    "recipient"           TEXT NOT NULL,
    "template_key"        TEXT NOT NULL,
    "event_type"          TEXT NOT NULL,
    "subject"             TEXT,
    "status"              "EmailDeliveryStatus" NOT NULL,
    "attempt_number"      INTEGER NOT NULL DEFAULT 0,
    "event_id"            UUID,
    "domain_id"           UUID,
    "assignment_id"       UUID,
    "month_key"           TEXT,
    "provider_message_id" TEXT,
    "reason"              TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_delivery_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_delivery_log_created_at_idx"     ON "email_delivery_log"("created_at");
CREATE INDEX "email_delivery_log_recipient_idx"      ON "email_delivery_log"("recipient");
CREATE INDEX "email_delivery_log_template_key_idx"   ON "email_delivery_log"("template_key", "created_at");
CREATE INDEX "email_delivery_log_status_idx"         ON "email_delivery_log"("status", "created_at");
CREATE INDEX "email_delivery_log_domain_id_idx"      ON "email_delivery_log"("domain_id", "created_at");
CREATE INDEX "email_delivery_log_event_id_idx"       ON "email_delivery_log"("event_id");
