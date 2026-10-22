import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/api/response";
import { normalizeEmail } from "@/lib/authorization/email";
import { writeAudit } from "@/lib/audit/write-audit";
import { enqueueEmail } from "@/lib/email/outbox";
import { assertValidProjectId } from "@/services/project-service";
import type { CreateVolunteerInput } from "@/lib/validation/schemas";
import type { Paginated } from "@/lib/utils/pagination";

export type VolunteerRow = {
  membershipId: string;
  personId: string;
  fullName: string;
  email: string;
  rollNumber: string | null;
  projectName: string | null;
  isActive: boolean;
  completedCount: number;
  assignedCount: number;
  upcomingCount: number;
  totalCount: number;
};

type RawRow = {
  membershipId: string;
  personId: string;
  fullName: string;
  emailNormalized: string;
  rollNumberNormalized: string | null;
  projectName: string | null;
  isActive: boolean;
  completedCount: bigint;
  assignedCount: bigint;
  upcomingCount: bigint;
  totalCount: bigint;
  total: bigint;
};

/**
 * Member list for ONE domain.
 *
 * Workload counting (one grouped SQL query — no N+1):
 *   countable population = non-removed assignments on events that are NOT
 *   cancelled/archived (cancelled/archived events are not workload). Applied
 *   identically to all three counts, so Total = Assigned + Completed.
 *   Assigned = status ASSIGNED; Completed = status COMPLETED.
 *
 * Default ordering is server-side and stability-safe across pages:
 *   sort="workload"  → least-loaded first: Total asc, Assigned asc,
 *                      roll number asc (nulls last), name asc, id asc
 *   sort="completed" → completed desc, name asc, id asc (member list page)
 *   sort="name"      → name asc, id asc
 */
export async function listVolunteers(args: {
  domainId: string;
  search?: string;
  projectId?: string;
  activeOnly: boolean;
  sort?: "workload" | "completed" | "name";
  page: number;
  limit: number;
}): Promise<Paginated<VolunteerRow>> {
  const { domainId, search = "", projectId, activeOnly, sort = "completed", page, limit } = args;
  const offset = (page - 1) * limit;
  const like = `%${search}%`;

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH members AS (
      SELECT
        vm.id                         AS "membershipId",
        p.id                          AS "personId",
        p."fullName"                  AS "fullName",
        p."emailNormalized"           AS "emailNormalized",
        p."rollNumberNormalized"      AS "rollNumberNormalized",
        pr.name                       AS "projectName",
        vm.is_active                  AS "isActive",
        COALESCE(SUM(CASE WHEN ea.status = 'COMPLETED' AND (e.id IS NULL OR (e.status <> 'CANCELLED' AND e.status <> 'ARCHIVED')) THEN 1 ELSE 0 END), 0) AS "completedCount",
        COALESCE(SUM(CASE WHEN ea.status = 'ASSIGNED' AND (e.id IS NULL OR (e.status <> 'CANCELLED' AND e.status <> 'ARCHIVED')) THEN 1 ELSE 0 END), 0) AS "assignedCount",
        COALESCE(SUM(CASE WHEN ea.status = 'ASSIGNED' AND e.status <> 'CANCELLED' AND e.end_at > now() THEN 1 ELSE 0 END), 0) AS "upcomingCount",
        COALESCE(SUM(CASE WHEN ea.id IS NOT NULL AND (e.id IS NULL OR (e.status <> 'CANCELLED' AND e.status <> 'ARCHIVED')) THEN 1 ELSE 0 END), 0) AS "totalCount",
        COUNT(*) OVER()               AS total
      FROM volunteer_membership vm
      JOIN person p ON p.id = vm.person_id
      LEFT JOIN project pr ON pr.id = vm.project_id
      LEFT JOIN event_assignment ea ON ea.volunteer_membership_id = vm.id AND ea.removed_at IS NULL
      LEFT JOIN event e ON e.id = ea.event_id
      WHERE vm.domain_id = ${domainId}::uuid
        AND vm.is_active = ${activeOnly}
        AND (${projectId ?? null}::uuid IS NULL OR vm.project_id = ${projectId ?? null}::uuid)
        AND (
          ${search} = ''
          OR p."fullName" ILIKE ${like}
          OR p."rollNumberNormalized" ILIKE ${like}
          OR p."emailNormalized" ILIKE ${like}
        )
      GROUP BY vm.id, p.id, p."fullName", p."emailNormalized", p."rollNumberNormalized", pr.name, vm.is_active
    )
    SELECT
      "membershipId", "personId", "fullName", "emailNormalized", "rollNumberNormalized",
      "projectName", "isActive", "completedCount", "assignedCount", "upcomingCount", "totalCount", total
    FROM members m
    ORDER BY
      -- workload: least-loaded first (Total asc, then Assigned asc)
      CASE WHEN ${sort} = 'workload' THEN m."totalCount" ELSE NULL END ASC NULLS LAST,
      CASE WHEN ${sort} = 'workload' THEN m."assignedCount" ELSE NULL END ASC NULLS LAST,
      -- completed: most completed first (member list page default)
      CASE WHEN ${sort} = 'completed' THEN m."completedCount" ELSE NULL END DESC NULLS LAST,
      -- name: alphabetical
      CASE WHEN ${sort} = 'name' THEN m."fullName" ELSE NULL END ASC NULLS LAST,
      -- stable deterministic tail ordering shared by every sort
      (m."rollNumberNormalized" IS NULL) ASC NULLS LAST,
      m."rollNumberNormalized" ASC NULLS LAST,
      m."fullName" ASC,
      m."membershipId" ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const items: VolunteerRow[] = rows.map((r) => ({
    membershipId: r.membershipId,
    personId: r.personId,
    fullName: r.fullName,
    email: r.emailNormalized,
    rollNumber: r.rollNumberNormalized,
    projectName: r.projectName,
    isActive: r.isActive,
    completedCount: Number(r.completedCount),
    assignedCount: Number(r.assignedCount),
    upcomingCount: Number(r.upcomingCount),
    totalCount: Number(r.totalCount),
  }));

  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return { items, page, limit, total, hasMore: page * limit < total };
}

/** Member detail/history scoped to a domain (domain scope in the predicate). */
export async function getVolunteerDetail(domainId: string, membershipId: string) {
  const membership = await prisma.volunteerMembership.findFirst({
    where: { id: membershipId, domainId },
    select: {
      id: true,
      isActive: true,
      joinedAt: true,
      endedAt: true,
      person: {
        select: { id: true, fullName: true, emailNormalized: true, rollNumberNormalized: true },
      },
      domain: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignments: {
        select: {
          id: true,
          status: true,
          assignedAt: true,
          completedAt: true,
          removedAt: true,
          event: {
            select: { id: true, title: true, startAt: true, endAt: true, status: true },
          },
        },
        orderBy: { assignedAt: "desc" },
      },
    },
  });

  if (!membership) throw notFound("Member not found.");
  return membership;
}

export async function getVolunteerMembershipDomainId(membershipId: string): Promise<string> {
  const membership = await prisma.volunteerMembership.findUnique({
    where: { id: membershipId },
    select: { domainId: true },
  });
  if (!membership) throw notFound("Member not found.");
  return membership.domainId;
}

/**
 * Creates a Person (+ membership) or attaches an existing Person to a domain.
 * Idempotent per (person, domain): re-adding re-activates the existing
 * membership rather than duplicating it.
 */
export async function createVolunteer(
  args: { input: CreateVolunteerInput; actorAppUserId: string; requestId: string },
): Promise<{ membershipId: string; personId: string }> {
  const { input, actorAppUserId, requestId } = args;
  const email = normalizeEmail(input.email);
  const roll = input.rollNumber?.trim().toUpperCase() || null;

  const domain = await prisma.domain.findUnique({ where: { id: input.domainId } });
  if (!domain) throw validationError({ domainId: "Unknown domain." }, "Unknown domain.");
  await assertValidProjectId(input.projectId);

  // Pre-validate uniqueness for a friendly error (constraint still enforced).
  const emailOwner = await prisma.person.findUnique({ where: { emailNormalized: email } });
  if (emailOwner && emailOwner.rollNumberNormalized && roll && emailOwner.rollNumberNormalized !== roll) {
    throw validationError({ email: "Email already belongs to another member." });
  }
  if (roll) {
    const rollOwner = await prisma.person.findUnique({ where: { rollNumberNormalized: roll } });
    if (rollOwner && rollOwner.emailNormalized !== email) {
      throw validationError({ rollNumber: "Roll number already in use." });
    }
  }

  return prisma.$transaction(async (tx) => {
    const person = await tx.person.upsert({
      where: { emailNormalized: email },
      update: {
        fullName: input.fullName,
        ...(roll ? { rollNumberNormalized: roll } : {}),
      },
      create: { fullName: input.fullName, emailNormalized: email, rollNumberNormalized: roll },
    });

    const existing = await tx.volunteerMembership.findFirst({
      where: { personId: person.id, domainId: input.domainId },
    });

    let membershipId: string;
    if (existing) {
      await tx.volunteerMembership.update({
        where: { id: existing.id },
        data: { isActive: true, endedAt: null, projectId: input.projectId },
      });
      membershipId = existing.id;
    } else {
      const created = await tx.volunteerMembership.create({
        data: {
          personId: person.id,
          domainId: input.domainId,
          projectId: input.projectId,
          isActive: true,
        },
      });
      membershipId = created.id;
    }

    await writeAudit(tx, {
      actorAppUserId,
      action: existing ? "VOLUNTEER_REACTIVATED" : "VOLUNTEER_CREATED",
      targetType: "VolunteerMembership",
      targetId: membershipId,
      domainId: input.domainId,
      requestId,
      after: { fullName: input.fullName, email, rollNumber: roll, domainId: input.domainId },
    });

    await enqueueEmail(tx, {
      eventType: "VOLUNTEER_CREATED",
      templateKey: "ROLE_ASSIGNED",
      recipient: email,
      payload: { fullName: input.fullName, domain: domain.name },
      idempotencyKey: `volunteer-created:${membershipId}`,
    });

    return { membershipId, personId: person.id };
  });
}

export async function updateVolunteer(args: {
  domainId: string;
  membershipId: string;
  actorAppUserId: string;
  requestId: string;
  data: {
    fullName?: string;
    rollNumber?: string | null;
    projectId?: string | null;
    isActive?: boolean;
  };
}): Promise<void> {
  const { domainId, membershipId, actorAppUserId, requestId, data } = args;
  await assertValidProjectId(data.projectId);

  await prisma.$transaction(async (tx) => {
    // Scope the lookup by domain — never fetch then check.
    const membership = await tx.volunteerMembership.findFirst({
      where: { id: membershipId, domainId },
      include: { person: true },
    });
    if (!membership) throw notFound("Member not found.");

    const before = {
      fullName: membership.person.fullName,
      rollNumber: membership.person.rollNumberNormalized,
      projectId: membership.projectId,
      isActive: membership.isActive,
    };

    if (data.fullName || data.rollNumber !== undefined) {
      await tx.person.update({
        where: { id: membership.personId },
        data: {
          ...(data.fullName ? { fullName: data.fullName } : {}),
          ...(data.rollNumber !== undefined
            ? { rollNumberNormalized: data.rollNumber ? data.rollNumber.trim().toUpperCase() : null }
            : {}),
        },
      });
    }

    const deactivating = data.isActive === false && membership.isActive;

    await tx.volunteerMembership.update({
      where: { id: membershipId },
      data: {
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(deactivating ? { endedAt: new Date() } : data.isActive ? { endedAt: null } : {}),
      },
    });

    const after = {
      fullName: data.fullName ?? before.fullName,
      rollNumber: data.rollNumber !== undefined ? data.rollNumber : before.rollNumber,
      projectId: data.projectId !== undefined ? data.projectId : before.projectId,
      isActive: data.isActive ?? before.isActive,
    };

    await writeAudit(tx, {
      actorAppUserId,
      action: deactivating ? "VOLUNTEER_DEACTIVATED" : "VOLUNTEER_UPDATED",
      targetType: "VolunteerMembership",
      targetId: membershipId,
      domainId,
      requestId,
      before,
      after,
    });

    if (deactivating) {
      await enqueueEmail(tx, {
        eventType: "ACCOUNT_DEACTIVATED",
        templateKey: "ACCOUNT_DEACTIVATED",
        recipient: membership.person.emailNormalized,
        payload: { fullName: membership.person.fullName },
        idempotencyKey: `volunteer-deactivated:${membershipId}:${Date.now()}`,
      });
    }
  });
}

/** The caller's own volunteer profile (self-service read). */
export async function getSelfProfile(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      fullName: true,
      emailNormalized: true,
      rollNumberNormalized: true,
      memberships: {
        select: {
          id: true,
          isActive: true,
          domain: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          assignments: {
            select: {
              id: true,
              status: true,
              assignedAt: true,
              completedAt: true,
              event: { select: { id: true, title: true, startAt: true, endAt: true, status: true } },
            },
          },
        },
      },
    },
  });
  if (!person) throw notFound("Profile not found.");
  return person;
}
