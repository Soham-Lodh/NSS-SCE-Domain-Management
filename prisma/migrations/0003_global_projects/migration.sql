-- 0003 — global member projects.
-- Projects are centralized groups, not domain-specific records. Existing
-- memberships keep an allowed project where possible; unknown project names
-- are detached because the product only accepts the nine canonical groups.

ALTER TABLE "pending_role_assignment"
  ADD COLUMN "project_id" UUID;

ALTER TABLE "pending_role_assignment"
  ADD CONSTRAINT "pending_role_assignment_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "volunteer_membership" vm
SET "project_id" = NULL
WHERE "project_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "project" p
    WHERE p."id" = vm."project_id"
      AND p."name" IN ('Bandhutva', 'Dhara', 'Nidaan', 'Riddhi', 'Sanyukt', 'Sparsh', 'Swet', 'Udaan', 'Urja')
  );

WITH canonical AS (
  SELECT LOWER("name") AS key, MIN("id"::text)::uuid AS keep_id
  FROM "project"
  WHERE "name" IN ('Bandhutva', 'Dhara', 'Nidaan', 'Riddhi', 'Sanyukt', 'Sparsh', 'Swet', 'Udaan', 'Urja')
  GROUP BY LOWER("name")
)
UPDATE "volunteer_membership" vm
SET "project_id" = c.keep_id
FROM "project" p
JOIN canonical c ON c.key = LOWER(p."name")
WHERE vm."project_id" = p."id"
  AND p."id" <> c.keep_id;

DELETE FROM "project" p
USING "project" keep
WHERE p."name" IN ('Bandhutva', 'Dhara', 'Nidaan', 'Riddhi', 'Sanyukt', 'Sparsh', 'Swet', 'Udaan', 'Urja')
  AND keep."name" = p."name"
  AND keep."id"::text < p."id"::text;

DELETE FROM "project"
WHERE "name" NOT IN ('Bandhutva', 'Dhara', 'Nidaan', 'Riddhi', 'Sanyukt', 'Sparsh', 'Swet', 'Udaan', 'Urja');

INSERT INTO "project" ("id", "name", "is_active", "created_at", "updated_at")
SELECT v."id"::uuid, v."name", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('00000000-0000-4000-8000-000000000001', 'Bandhutva'),
  ('00000000-0000-4000-8000-000000000002', 'Dhara'),
  ('00000000-0000-4000-8000-000000000003', 'Nidaan'),
  ('00000000-0000-4000-8000-000000000004', 'Riddhi'),
  ('00000000-0000-4000-8000-000000000005', 'Sanyukt'),
  ('00000000-0000-4000-8000-000000000006', 'Sparsh'),
  ('00000000-0000-4000-8000-000000000007', 'Swet'),
  ('00000000-0000-4000-8000-000000000008', 'Udaan'),
  ('00000000-0000-4000-8000-000000000009', 'Urja')
) AS v("id", "name")
WHERE NOT EXISTS (SELECT 1 FROM "project" p WHERE p."name" = v."name");

DROP INDEX IF EXISTS "project_domain_id_is_active_idx";
DROP INDEX IF EXISTS "project_domain_id_name_key";

ALTER TABLE "project"
  DROP CONSTRAINT IF EXISTS "project_domain_id_fkey";

ALTER TABLE "project"
  DROP COLUMN IF EXISTS "domain_id";

CREATE UNIQUE INDEX "project_name_key" ON "project"("name");
CREATE INDEX "project_is_active_idx" ON "project"("is_active");

ALTER TABLE "project"
  ADD CONSTRAINT "project_allowed_name"
  CHECK ("name" IN ('Bandhutva', 'Dhara', 'Nidaan', 'Riddhi', 'Sanyukt', 'Sparsh', 'Swet', 'Udaan', 'Urja'));
