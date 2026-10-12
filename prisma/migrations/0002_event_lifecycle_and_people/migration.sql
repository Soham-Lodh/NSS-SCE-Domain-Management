-- 0002 — event lifecycle completion + reminder tracking, person year/gender,
--        and pre-assigned roles for people added before they sign in.
-- All statements are ADDITIVE and non-destructive to existing data.

-- Explicit COMPLETED status: an event is only ever ended by a domain lead.
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Optional demographic fields from the volunteer import sheet.
ALTER TABLE "person" ADD COLUMN "year" TEXT;
ALTER TABLE "person" ADD COLUMN "gender" TEXT;

-- Manual end + deadline reminder bookkeeping.
ALTER TABLE "event" ADD COLUMN "ended_at" TIMESTAMP(3);
ALTER TABLE "event" ADD COLUMN "reminder_4d_sent_at" TIMESTAMP(3);
ALTER TABLE "event" ADD COLUMN "reminder_24h_sent_at" TIMESTAMP(3);

-- Role pre-assignment applied at first login.
CREATE TABLE "pending_role_assignment" (
    "id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "AppRole" NOT NULL,
    "domain_id" UUID,
    "is_consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_by_app_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "pending_role_assignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_role_assignment_email_normalized_key"
    ON "pending_role_assignment"("email_normalized");

CREATE INDEX "pending_role_assignment_is_consumed_idx"
    ON "pending_role_assignment"("is_consumed");

ALTER TABLE "pending_role_assignment"
    ADD CONSTRAINT "pending_role_assignment_domain_id_fkey"
    FOREIGN KEY ("domain_id") REFERENCES "domain"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
