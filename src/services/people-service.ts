import "server-only";

import { prisma } from "@/lib/db/prisma";
import { forbidden, notFound, validationError } from "@/lib/api/response";
import { allowedEmailDomains } from "@/lib/env";
import { isEmailAllowed, normalizeEmail } from "@/lib/authorization/email";
import { writeAudit } from "@/lib/audit/write-audit";
import { canManageRole, wouldRemoveLastCoordinator } from "@/lib/authorization/roles";
import type { AuthContext, AppRole } from "@/lib/auth/types";
import { changeUserRole } from "@/services/user-admin-service";
import { assertValidProjectId } from "@/services/project-service";

export type PendingPerson = {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  domainId: string | null;
  projectId: string | null;
  domainName: string | null;
  projectName: string | null;
  createdAt: Date;
};

export type AddPersonResult = { mode: "role-applied" | "invited"; id: string };

/**
 * "Plain simple" add-a-person: name + email + role (+ domain for domain lead or
 * volunteer). If the person already has an account, the role is applied
 * immediately (reusing the hierarchy/self/last-coordinator checks). Otherwise a
 * pending role assignment is stored and applied at their first login — so an
 * admin never has to wait for the person to sign in.
 */
export async function addPerson(args: {
  actor: AuthContext;
  fullName: string;
  email: string;
  role: AppRole;
  domainId: string | null;
  projectId?: string | null;
  requestId: string;
}): Promise<AddPersonResult> {
  const { actor, fullName, email, role, domainId, projectId = null, requestId } = args;
  const normalized = normalizeEmail(email);

  if (!isEmailAllowed(normalized, allowedEmailDomains())) {
    throw validationError({
      email: `Email must end with ${allowedEmailDomains().map((d) => `@${d}`).join(" or ")}.`,
    });
  }
  if (!canManageRole(actor.roles, role, "ADD")) throw forbidden();
  if (role === "DOMAIN_LEAD" && !domainId) {
    throw validationError({ domainId: "A domain is required for a domain lead." });
  }
  if ((role === "DOMAIN_LEAD" || role === "VOLUNTEER") && !projectId) {
    throw validationError({ projectId: "A project is required for a domain member." });
  }
  if (domainId) {
    const domain = await prisma.domain.findUnique({ where: { id: domainId }, select: { id: true } });
    if (!domain) throw validationError({ domainId: "Unknown domain." });
  }
  await assertValidProjectId(projectId);

  // Does this person already have an account?
  const person = await prisma.person.findUnique({
    where: { emailNormalized: normalized },
    include: { appUser: true },
  });

  if (person?.appUser) {
    await changeUserRole({
      actor,
      targetAppUserId: person.appUser.id,
      role,
      domainId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? domainId : null,
      projectId,
      requestId,
    });
    return { mode: "role-applied", id: person.appUser.id };
  }

  return prisma.$transaction(async (tx) => {
    const p = await tx.person.upsert({
      where: { emailNormalized: normalized },
      update: { fullName },
      create: { fullName, emailNormalized: normalized },
    });

    // A volunteer belongs to a domain → create the membership now so they show
    // up in the domain's volunteer list even before they sign in.
    if ((role === "VOLUNTEER" || role === "DOMAIN_LEAD") && domainId) {
      const existingMembership = await tx.volunteerMembership.findFirst({
        where: { personId: p.id, domainId },
      });
      if (existingMembership) {
        await tx.volunteerMembership.update({
          where: { id: existingMembership.id },
          data: { isActive: true, endedAt: null, projectId },
        });
      } else {
        await tx.volunteerMembership.create({
          data: { personId: p.id, domainId, projectId },
        });
      }
    }

    const pending = await tx.pendingRoleAssignment.upsert({
      where: { emailNormalized: normalized },
      update: {
        fullName,
        role,
        domainId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? domainId : null,
        projectId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? projectId : null,
        isConsumed: false,
        consumedAt: null,
        createdByAppUserId: actor.appUserId,
      },
      create: {
        emailNormalized: normalized,
        fullName,
        role,
        domainId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? domainId : null,
        projectId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? projectId : null,
        createdByAppUserId: actor.appUserId,
      },
    });

    await writeAudit(tx, {
      actorAppUserId: actor.appUserId,
      action: "PERSON_INVITED",
      targetType: "PendingRoleAssignment",
      targetId: pending.id,
      domainId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? domainId : null,
      requestId,
      after: { email: normalized, role, projectId },
    });

    return { mode: "invited" as const, id: pending.id };
  });
}

export async function listPendingPeople(): Promise<PendingPerson[]> {
  const rows = await prisma.pendingRoleAssignment.findMany({
    where: { isConsumed: false },
    select: {
      id: true,
      fullName: true,
      emailNormalized: true,
      role: true,
      domainId: true,
      projectId: true,
      createdAt: true,
      domain: { select: { name: true } },
      project: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.emailNormalized,
    role: r.role,
    domainId: r.domainId,
    projectId: r.projectId,
    domainName: r.domain?.name ?? null,
    projectName: r.project?.name ?? null,
    createdAt: r.createdAt,
  }));
}

/**
 * Removes a person's access. For an existing account we deactivate it and
 * revoke active grants (history is retained — never a hard delete). For a
 * pending invitation we delete the pending record.
 */
export async function removePerson(args: {
  actor: AuthContext;
  kind: "user" | "pending";
  id: string;
  requestId: string;
}): Promise<void> {
  const { actor, kind, id, requestId } = args;

  if (kind === "pending") {
    const pending = await prisma.pendingRoleAssignment.findUnique({ where: { id } });
    if (!pending) throw notFound("Invitation not found.");
    if (!canManageRole(actor.roles, pending.role, "REMOVE")) throw forbidden();
    await prisma.$transaction(async (tx) => {
      await tx.pendingRoleAssignment.delete({ where: { id } });
      await writeAudit(tx, {
        actorAppUserId: actor.appUserId,
        action: "PERSON_INVITE_REVOKED",
        targetType: "PendingRoleAssignment",
        targetId: id,
        outcome: "SUCCESS",
        requestId,
        before: { email: pending.emailNormalized, role: pending.role },
      });
    });
    return;
  }

  if (actor.appUserId === id) throw forbidden("You cannot remove your own account.");

  await prisma.$transaction(async (tx) => {
    const target = await tx.appUser.findUnique({
      where: { id },
      include: { person: true, roleGrants: { where: { isActive: true } } },
    });
    if (!target) throw notFound("Account not found.");

    for (const grant of target.roleGrants) {
      if (!canManageRole(actor.roles, grant.role, "REMOVE")) throw forbidden();
      if (grant.role === "COORDINATOR") {
        const activeCoordinators = await tx.roleGrant.count({
          where: { role: "COORDINATOR", isActive: true },
        });
        if (wouldRemoveLastCoordinator(activeCoordinators, true)) {
          throw forbidden("The last active coordinator cannot be removed.");
        }
      }
    }

    await tx.appUser.update({ where: { id }, data: { isActive: false } });
    await tx.roleGrant.updateMany({
      where: { appUserId: id, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });

    await writeAudit(tx, {
      actorAppUserId: actor.appUserId,
      action: "PERSON_DEACTIVATED",
      targetType: "AppUser",
      targetId: id,
      requestId,
      before: { isActive: true, roles: target.roleGrants.map((g) => g.role) },
      after: { isActive: false },
    });
  });
}
