-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('VOLUNTEER', 'DOMAIN_LEAD', 'TECH_TEAM', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentAction" AS ENUM ('ASSIGNED', 'COMPLETED', 'REOPENED', 'REMOVED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "rollNumberNormalized" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "supabase_auth_user_id" TEXT NOT NULL,
    "person_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volunteer_membership" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "project_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volunteer_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_grant" (
    "id" UUID NOT NULL,
    "app_user_id" UUID NOT NULL,
    "role" "AppRole" NOT NULL,
    "domain_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "granted_by_app_user_id" UUID,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "role_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_by_app_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_assignment" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "volunteer_membership_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_by_app_user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_history" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "actor_app_user_id" UUID,
    "action" "AssignmentAction" NOT NULL,
    "from_event_id" UUID,
    "to_event_id" UUID,
    "from_status" "AssignmentStatus",
    "to_status" "AssignmentStatus",
    "request_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_app_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "domain_id" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "request_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "last_error_summary" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_emailNormalized_key" ON "person"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "person_rollNumberNormalized_key" ON "person"("rollNumberNormalized");

-- CreateIndex
CREATE INDEX "person_fullName_idx" ON "person"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_supabase_auth_user_id_key" ON "app_user"("supabase_auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_person_id_key" ON "app_user"("person_id");

-- CreateIndex
CREATE INDEX "app_user_is_active_idx" ON "app_user"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "domain_name_key" ON "domain"("name");

-- CreateIndex
CREATE INDEX "domain_is_active_idx" ON "domain"("is_active");

-- CreateIndex
CREATE INDEX "project_domain_id_is_active_idx" ON "project"("domain_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "project_domain_id_name_key" ON "project"("domain_id", "name");

-- CreateIndex
CREATE INDEX "volunteer_membership_domain_id_is_active_person_id_idx" ON "volunteer_membership"("domain_id", "is_active", "person_id");

-- CreateIndex
CREATE INDEX "volunteer_membership_person_id_is_active_idx" ON "volunteer_membership"("person_id", "is_active");

-- CreateIndex
CREATE INDEX "role_grant_app_user_id_is_active_idx" ON "role_grant"("app_user_id", "is_active");

-- CreateIndex
CREATE INDEX "role_grant_role_is_active_idx" ON "role_grant"("role", "is_active");

-- CreateIndex
CREATE INDEX "role_grant_domain_id_is_active_idx" ON "role_grant"("domain_id", "is_active");

-- CreateIndex
CREATE INDEX "event_domain_id_status_start_at_idx" ON "event"("domain_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "event_domain_id_end_at_idx" ON "event"("domain_id", "end_at");

-- CreateIndex
CREATE INDEX "event_start_at_idx" ON "event"("start_at");

-- CreateIndex
CREATE INDEX "event_assignment_event_id_status_idx" ON "event_assignment"("event_id", "status");

-- CreateIndex
CREATE INDEX "event_assignment_volunteer_membership_id_status_idx" ON "event_assignment"("volunteer_membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_assignment_event_id_volunteer_membership_id_key" ON "event_assignment"("event_id", "volunteer_membership_id");

-- CreateIndex
CREATE INDEX "assignment_history_assignment_id_occurred_at_idx" ON "assignment_history"("assignment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "assignment_history_occurred_at_idx" ON "assignment_history"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_app_user_id_created_at_idx" ON "audit_log"("actor_app_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_domain_id_created_at_idx" ON "audit_log"("domain_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_idempotency_key_key" ON "email_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_membership" ADD CONSTRAINT "volunteer_membership_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_membership" ADD CONSTRAINT "volunteer_membership_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteer_membership" ADD CONSTRAINT "volunteer_membership_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_granted_by_app_user_id_fkey" FOREIGN KEY ("granted_by_app_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_app_user_id_fkey" FOREIGN KEY ("created_by_app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignment" ADD CONSTRAINT "event_assignment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignment" ADD CONSTRAINT "event_assignment_volunteer_membership_id_fkey" FOREIGN KEY ("volunteer_membership_id") REFERENCES "volunteer_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_assignment" ADD CONSTRAINT "event_assignment_assigned_by_app_user_id_fkey" FOREIGN KEY ("assigned_by_app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "event_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_actor_app_user_id_fkey" FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_app_user_id_fkey" FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Additional integrity constraints not expressible in the Prisma schema.
-- Reviewed SQL: no destructive operations against existing data.
-- ---------------------------------------------------------------------------

-- An event must end after it starts.
ALTER TABLE "event"
  ADD CONSTRAINT "event_end_after_start" CHECK ("end_at" > "start_at");

-- A person may hold at most one ACTIVE membership per domain.
CREATE UNIQUE INDEX "volunteer_membership_active_unique"
  ON "volunteer_membership" ("person_id", "domain_id")
  WHERE "is_active";

-- At most one ACTIVE grant per (app_user, role, scope). COALESCE maps a NULL
-- domain (global roles) to a fixed sentinel so NULLs are compared as equal.
CREATE UNIQUE INDEX "role_grant_active_unique"
  ON "role_grant" ("app_user_id", "role", COALESCE("domain_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "is_active";
