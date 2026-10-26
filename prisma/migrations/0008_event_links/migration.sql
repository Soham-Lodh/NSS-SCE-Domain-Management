CREATE TABLE "event_link" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_link_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "event_link_event_id_idx" ON "event_link"("event_id");
