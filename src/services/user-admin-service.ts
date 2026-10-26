import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound, validationError } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/write-audit";
import { enqueueEmail } from "@/lib/email/outbox";
import {
  canAddTechTeam,
  canManageCoordinators,
  canManageVolunteerMaster,
  canRemoveTechTeam,
  wouldRemoveLastCoordinator,
} from "@/lib/authorization/roles";
import type { AuthContext, AppRole } from "@/lib/auth/types";
import type { Paginated } from "@/lib/utils/pagination";

export type UserRow = {
  appUserId: string;
  fullName: string;
  email: string;
  role: AppRole;
  domainId: string | null;
  domainName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
};

export async function listUsers(args: {
  search?: string;
  page: number;
  limit: number;
}): Promise<Paginated<UserRow>> {
  const { search = "", page, limit } = args;
  const where: Prisma.AppUserWhereInput = {
    roleGrants: {
      some: {
        isActive: true,
        role: { in: ["COORDINATOR", "TECH_TEAM", "DOMAIN_LEAD"] },
      },
    },
    ...(search
      ? {
          person: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { emailNormalized: { contains: search, mode: "insensitive" } },
              { rollNumberNormalized: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.appUser.count({ where }),
    prisma.appUser.findMany({
      where,
      select: {
        id: true,
        isActive: true,
        lastLoginAt: true,
        person: { select: { fullName: true, emailNormalized: true } },
        roleGrants: {
          where: { isActive: true },
          select: { role: true, domainId: true, domain: { select: { name: true } } },
        },
      },
      orderBy: { person: { fullName: "asc" } },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const items: UserRow[] = rows.map((u) => {
    const grant = u.roleGrants[0];
    return {
      appUserId: u.id,
      fullName: u.person.fullName,
      email: u.person.emailNormalized,
      role: grant?.role ?? "VOLUNTEER",
      domainId: grant?.domainId ?? null,
      domainName: grant?.domain?.name ?? null,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
    };
  });

  return { items, page, limit, total, hasMore: page * limit < total };
}

/**
 * Sets a user's role. Domain-lead grants are additive per domain; top-level
 * roles still replace the previous active grants.
 *
 * Enforces, in one transaction:
 *  - no self role change
 *  - role-hierarchy: tech team cannot add/remove coordinators
 *  - last active coordinator cannot be removed/demoted
 *  - domain lead requires a domain
 */
export async function changeUserRole(args: {
  actor: AuthContext;
  targetAppUserId: string;
  role: AppRole;
  domainId: string | null;
  projectId?: string | null;
  requestId: string;
}): Promise<void> {
  const { actor, targetAppUserId, role, domainId, projectId, requestId } = args;

  if (actor.appUserId === targetAppUserId) throw forbidden("You cannot change your own role.");
  if (role === "DOMAIN_LEAD" && !domainId) {
    throw validationError({ domainId: "A domain is required for a domain lead." });
  }
  if ((role === "DOMAIN_LEAD" || role === "VOLUNTEER") && !projectId) {
    throw validationError({ projectId: "A project is required for a domain member." });
  }

  await prisma.$transaction(async (tx) => {
    const target = await tx.appUser.findUnique({
      where: { id: targetAppUserId },
      include: {
        person: true,
        roleGrants: { where: { isActive: true } },
      },
    });
    if (!target) throw notFound("User not found.");

    if (domainId) {
      const domain = await tx.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true } });
      if (!domain) throw validationError({ domainId: "Unknown domain." });
    }
    if (projectId) {
      const project = await tx.project.findFirst({ where: { id: projectId, isActive: true }, select: { id: true } });
      if (!project) throw validationError({ projectId: "Select one of the approved projects." });
    }

    const currentRoles = new Set(target.roleGrants.map((g) => g.role));
    const currentlyCoordinator = currentRoles.has("COORDINATOR");
    const currentlyTech = currentRoles.has("TECH_TEAM");

    if (role === "DOMAIN_LEAD") {
      if (!canManageVolunteerMaster(actor.roles)) throw forbidden();

      const before = {
        roles: Array.from(currentRoles),
        domainIds: target.roleGrants
          .filter((g) => g.role === "DOMAIN_LEAD" && g.domainId)
          .map((g) => g.domainId),
      };

      const existingGrant = target.roleGrants.find((g) => g.role === "DOMAIN_LEAD" && g.domainId === domainId);
      if (!existingGrant) {
        await tx.roleGrant.create({
          data: {
            appUserId: targetAppUserId,
            role,
            domainId,
            isActive: true,
            grantedByAppUserId: actor.appUserId,
          },
        });
      }

      const existingMembership = await tx.volunteerMembership.findFirst({
        where: { personId: target.personId, domainId: domainId! },
        select: { id: true, isActive: true },
      });
      if (existingMembership) {
        await tx.volunteerMembership.update({
          where: { id: existingMembership.id },
          data: { isActive: true, endedAt: null, projectId },
        });
      } else {
        await tx.volunteerMembership.create({
          data: { personId: target.personId, domainId: domainId!, projectId },
        });
      }

      await writeAudit(tx, {
        actorAppUserId: actor.appUserId,
        action: existingGrant ? "ROLE_CHANGED" : "ROLE_ASSIGNED",
        targetType: "AppUser",
        targetId: targetAppUserId,
        domainId,
        requestId,
        before,
        after: {
          roles: Array.from(new Set([...Array.from(currentRoles), "DOMAIN_LEAD"])),
          domainIds: Array.from(new Set([...before.domainIds, domainId])),
        },
      });

      if (!existingGrant) {
        await enqueueEmail(tx, {
          eventType: "ROLE_ASSIGNED",
          templateKey: "DOMAIN_LEAD_ASSIGNED",
          recipient: target.person.emailNormalized,
          payload: { fullName: target.person.fullName, role, domainId },
          idempotencyKey: `domain-lead:${targetAppUserId}:${domainId}`,
        });
      }
      return;
    }

    if (role === "VOLUNTEER") {
      if (!domainId) throw validationError({ domainId: "A domain is required for a volunteer." });
      if (!canManageVolunteerMaster(actor.roles)) throw forbidden();

      const before = {
        roles: Array.from(currentRoles),
        domainIds: target.roleGrants
          .filter((g) => g.role === "DOMAIN_LEAD" && g.domainId)
          .map((g) => g.domainId),
      };

      await tx.roleGrant.updateMany({
        where: { appUserId: targetAppUserId, isActive: true },
        data: { isActive: false, revokedAt: new Date() },
      });

      await tx.roleGrant.create({
        data: {
          appUserId: targetAppUserId,
          role,
          domainId: null,
          isActive: true,
          grantedByAppUserId: actor.appUserId,
        },
      });

      const existingMembership = await tx.volunteerMembership.findFirst({
        where: { personId: target.personId, domainId },
        select: { id: true },
      });
      if (existingMembership) {
        await tx.volunteerMembership.update({
          where: { id: existingMembership.id },
          data: { isActive: true, endedAt: null, projectId },
        });
      } else {
        await tx.volunteerMembership.create({
          data: { personId: target.personId, domainId, projectId },
        });
      }

      await writeAudit(tx, {
        actorAppUserId: actor.appUserId,
        action: "ROLE_CHANGED",
        targetType: "AppUser",
        targetId: targetAppUserId,
        domainId,
        requestId,
        before,
        after: { roles: [role], domainId, projectId },
      });

      await enqueueEmail(tx, {
        eventType: "ROLE_ASSIGNED",
        templateKey: "ROLE_ASSIGNED",
        recipient: target.person.emailNormalized,
        payload: { fullName: target.person.fullName, role, domainId },
        idempotencyKey: `role-change:${targetAppUserId}:${role}:${domainId}:${Date.now()}`,
      });
      return;
    }

    // --- Authority checks ---
    if (role === "COORDINATOR" && !canManageCoordinators(actor.roles)) {
      throw forbidden("Only a coordinator can assign the coordinator role.");
    }
    if (currentlyCoordinator && role !== "COORDINATOR") {
      if (!canManageCoordinators(actor.roles)) {
        throw forbidden("Only a coordinator can remove a coordinator.");
      }
      const activeCoordinators = await tx.roleGrant.count({
        where: { role: "COORDINATOR", isActive: true },
      });
      if (wouldRemoveLastCoordinator(activeCoordinators, true)) {
        throw forbidden("The last active coordinator cannot be removed or demoted.");
      }
    }
    if ((role === "TECH_TEAM" && !canAddTechTeam(actor.roles)) || (currentlyTech && !canRemoveTechTeam(actor.roles))) {
      throw forbidden();
    }
    if (role !== "TECH_TEAM" && role !== "COORDINATOR" && !currentlyCoordinator && !currentlyTech) {
      if (!canManageVolunteerMaster(actor.roles)) throw forbidden();
    }

    const before = {
      roles: Array.from(currentRoles),
      domainId: target.roleGrants.find((g) => g.role === "DOMAIN_LEAD")?.domainId ?? null,
    };

    await tx.roleGrant.updateMany({
      where: { appUserId: targetAppUserId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });

    await tx.roleGrant.create({
      data: {
        appUserId: targetAppUserId,
        role,
        domainId: null,
        isActive: true,
        grantedByAppUserId: actor.appUserId,
      },
    });

    await writeAudit(tx, {
      actorAppUserId: actor.appUserId,
      action: "ROLE_CHANGED",
      targetType: "AppUser",
      targetId: targetAppUserId,
      domainId: before.domainId,
      requestId,
      before,
      after: { roles: [role], domainId: null },
    });

    await enqueueEmail(tx, {
      eventType: "ROLE_ASSIGNED",
      templateKey: "ROLE_ASSIGNED",
      recipient: target.person.emailNormalized,
      payload: { fullName: target.person.fullName, role },
      idempotencyKey: `role-change:${targetAppUserId}:${role}:${Date.now()}`,
    });
  });
}
