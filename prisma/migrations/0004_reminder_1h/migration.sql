-- 0004 — 1-hour deadline reminder tracking.
-- Additive and non-destructive to existing data.

ALTER TABLE "event" ADD COLUMN IF NOT EXISTS "reminder_1h_sent_at" TIMESTAMP(3);
