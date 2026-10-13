import "server-only";

import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/write-audit";
import { enqueueEmail } from "@/lib/email/outbox";

export type BulkAssignOutcome = {
  membershipId: string;
  result: "assigned" | "already_assigned" | "rejected";
  reason?: string;
};

export type BulkAssignSummary = {
  assigned: number;
  alreadyAssigned: number;
  rejected: number;
  results: BulkAssignOutcome[];
};

export async function getAssignmentDomainId(assignmentId: string): Promise<string> {
  const assignment = await prisma.eventAssignment.findUnique({
    where: { id: assignmentId },
    select: { event: { select: { domainId: true } } },
  });
  if (!assignment) throw notFound("Assignment not found.");
  return assignment.event.domainId;
}

/**
 * Assigns multiple volunteers (memberships) to one event.
 *
 * - Event and every membership are validated to belong to the given domain.
 * - Duplicates are de-duplicated up front and the DB unique
 *   (event_id, volunteer_membership_id) constraint is the final guarantee, so
 *   concurrent requests can never create two credits.
 * - Returns per-volunteer outcomes: assigned / already_assigned / rejected.
 */
export async function bulkAssign(args: {
  eventId: string;
  domainId: string;
  membershipIds: string[];
  actorAppUserId: string;
  requestId: string;
}): Promise<BulkAssignSummary> {
  const { eventId, domainId, membershipIds, actorAppUserId, requestId } = args;

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, domainId },
      select: { id: true, title: true, status: true },
    });
    if (!event) throw notFound("Event not found.");
    if (event.status !== "SCHEDULED") {
      throw validationError({ eventId: "Reopen the event before changing assignments." });
    }

    // Validate memberships belong to this domain AND are active in one query.
    const memberships = await tx.volunteerMembership.findMany({
      where: { id: { in: membershipIds }, domainId, isActive: true },
      select: { id: true, person: { select: { fullName: true, emailNormalized: true } } },
    });
    const valid = new Map(memberships.map((m) => [m.id, m]));

    // Existing assignments for this event. Removed rows are reactivated instead
    // of duplicated so the event/membership unique constraint remains the
    // single-credit guard.
    const existing = await tx.eventAssignment.findMany({
      where: { eventId, volunteerMembershipId: { in: membershipIds } },
      select: { id: true, volunteerMembershipId: true, removedAt: true },
    });
    const existingByMembership = new Map(existing.map((e) => [e.volunteerMembershipId, e]));

    const results: BulkAssignOutcome[] = [];
    const toCreate: string[] = [];
    const toReactivate: string[] = [];

    for (const membershipId of membershipIds) {
      if (!valid.has(membershipId)) {
        results.push({
          membershipId,
          result: "rejected",
          reason: "Not an active member of this domain.",
        });
        continue;
      }
      const current = existingByMembership.get(membershipId);
      if (current) {
        if (current.removedAt === null) {
          results.push({ membershipId, result: "already_assigned" });
          continue;
        }
        toReactivate.push(current.id);
      } else {
        toCreate.push(membershipId);
      }
      results.push({ membershipId, result: "assigned" });
    }

    if (toReactivate.length > 0) {
      await tx.eventAssignment.updateMany({
        where: { id: { in: toReactivate } },
        data: {
          status: "ASSIGNED",
          removedAt: null,
          completedAt: null,
          assignedByAppUserId: actorAppUserId,
          assignedAt: new Date(),
        },
      });
    }

    if (toCreate.length > 0) {
      // skipDuplicates defends against concurrent identical requests.
      await tx.eventAssignment.createMany({
        data: toCreate.map((membershipId) => ({
          eventId,
          volunteerMembershipId: membershipId,
          status: "ASSIGNED" as const,
          assignedByAppUserId: actorAppUserId,
        })),
        skipDuplicates: true,
      });
    }

    const assignedMembershipIds = [...toCreate, ...toReactivate.map((id) => {
      const match = existing.find((e) => e.id === id);
      return match?.volunteerMembershipId;
    }).filter((id): id is string => !!id)];

    if (assignedMembershipIds.length > 0) {
      const assignedRows = await tx.eventAssignment.findMany({
        where: { eventId, volunteerMembershipId: { in: assignedMembershipIds }, removedAt: null },
        select: { id: true, volunteerMembershipId: true },
      });

      await tx.assignmentHistory.createMany({
        data: assignedRows.map((c) => ({
          assignmentId: c.id,
          actorAppUserId,
          action: "ASSIGNED" as const,
          toEventId: eventId,
          toStatus: "ASSIGNED" as const,
          requestId,
        })),
      });

      for (const membershipId of assignedMembershipIds) {
        const m = valid.get(membershipId)!;
        await enqueueEmail(tx, {
          eventType: "EVENT_ASSIGNED",
          templateKey: "EVENT_ASSIGNED",
          recipient: m.person.emailNormalized,
          payload: { fullName: m.person.fullName, event: event.title },
          idempotencyKey: `event-assigned:${eventId}:${membershipId}`,
        });
      }
    }

    await writeAudit(tx, {
      actorAppUserId,
      action: "ASSIGNMENTS_BULK_ADDED",
      targetType: "Event",
      targetId: eventId,
      domainId,
      requestId,
      after: {
        assigned: assignedMembershipIds.length,
        reactivated: toReactivate.length,
        alreadyAssigned: results.filter((r) => r.result === "already_assigned").length,
        requested: membershipIds.length,
      },
    });

    const assigned = results.filter((r) => r.result === "assigned").length;
    const alreadyAssigned = results.filter((r) => r.result === "already_assigned").length;
    const rejected = results.filter((r) => r.result === "rejected").length;
    return { assigned, alreadyAssigned, rejected, results };
  });
}

/** Marks one assignment completed. Idempotent — at most one completion credit. */
export async function completeAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.eventAssignment.findFirst({
      where: { id: assignmentId, removedAt: null, event: { domainId } },
      select: {
        id: true,
        status: true,
        eventId: true,
        volunteerMembershipId: true,
        event: { select: { status: true } },
      },
    });
    if (!assignment) throw notFound("Assignment not found.");
    if (assignment.event.status !== "SCHEDULED") {
      throw validationError({ assignmentId: "Reopen the event before changing assignments." });
    }
    if (assignment.status === "COMPLETED") return; // idempotent no-op

    await tx.eventAssignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId,
        actorAppUserId,
        action: "COMPLETED",
        fromEventId: assignment.eventId,
        toEventId: assignment.eventId,
        fromStatus: assignment.status,
        toStatus: "COMPLETED",
        requestId,
      },
    });
    await writeAudit(tx, {
      actorAppUserId,
      action: "ASSIGNMENT_COMPLETED",
      targetType: "EventAssignment",
      targetId: assignmentId,
      domainId,
      requestId,
      before: { status: assignment.status },
      after: { status: "COMPLETED" },
    });
  });
}

/** Reopens a completed assignment (reverses a completion). */
export async function reopenAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.eventAssignment.findFirst({
      where: { id: assignmentId, removedAt: null, event: { domainId } },
      select: { id: true, status: true, eventId: true, event: { select: { status: true } } },
    });
    if (!assignment) throw notFound("Assignment not found.");
    if (assignment.event.status !== "SCHEDULED") {
      throw validationError({ assignmentId: "Reopen the event before changing assignments." });
    }
    if (assignment.status === "ASSIGNED") return;

    await tx.eventAssignment.update({
      where: { id: assignmentId },
      data: { status: "ASSIGNED", completedAt: null },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId,
        actorAppUserId,
        action: "REOPENED",
        fromEventId: assignment.eventId,
        toEventId: assignment.eventId,
        fromStatus: assignment.status,
        toStatus: "ASSIGNED",
        requestId,
      },
    });
    await writeAudit(tx, {
      actorAppUserId,
      action: "ASSIGNMENT_REOPENED",
      targetType: "EventAssignment",
      targetId: assignmentId,
      domainId,
      requestId,
      before: { status: assignment.status },
      after: { status: "ASSIGNED" },
    });
  });
}

/**
 * Soft-removes an assignment by stamping removedAt. The row is retained so
 * re-adding the same volunteer reactivates it — a single current-state row per
 * (event, membership) means no duplicate credit is ever possible.
 */
export async function removeAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.eventAssignment.findFirst({
      where: { id: assignmentId, removedAt: null, event: { domainId } },
      select: {
        id: true,
        status: true,
        eventId: true,
        volunteerMembershipId: true,
        event: { select: { status: true } },
      },
    });
    if (!assignment) throw notFound("Assignment not found.");
    if (assignment.event.status !== "SCHEDULED") {
      throw validationError({ assignmentId: "Reopen the event before changing assignments." });
    }

    await tx.eventAssignment.update({
      where: { id: assignmentId },
      data: { removedAt: new Date() },
    });
    await tx.assignmentHistory.create({
      data: {
        assignmentId,
        actorAppUserId,
        action: "REMOVED",
        fromEventId: assignment.eventId,
        fromStatus: assignment.status,
        requestId,
      },
    });
    await writeAudit(tx, {
      actorAppUserId,
      action: "ASSIGNMENT_REMOVED",
      targetType: "EventAssignment",
      targetId: assignmentId,
      domainId,
      requestId,
      before: { status: assignment.status },
      after: { removed: true },
    });
  });
}

/**
 * Atomically moves a membership's assignment to another event in the same
 * domain, preserving history. If the destination already has an (active)
 * assignment the source is simply removed.
 */
export async function reassignAssignment(args: {
  assignmentId: string;
  targetEventId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, targetEventId, domainId, actorAppUserId, requestId } = args;

  await prisma.$transaction(async (tx) => {
    const source = await tx.eventAssignment.findFirst({
      where: { id: assignmentId, removedAt: null, event: { domainId } },
      select: {
        id: true,
        eventId: true,
        status: true,
        volunteerMembershipId: true,
        event: { select: { status: true } },
      },
    });
    if (!source) throw notFound("Assignment not found.");
    if (source.event.status !== "SCHEDULED") {
      throw validationError({ assignmentId: "Reopen the event before changing assignments." });
    }
    if (source.eventId === targetEventId) {
      throw validationError({ targetEventId: "Already assigned to that event." });
    }

    const target = await tx.event.findFirst({
      where: { id: targetEventId, domainId },
      select: { id: true, title: true, status: true },
    });
    if (!target) throw notFound("Target event not found.");
    if (target.status !== "SCHEDULED") {
      throw validationError({ targetEventId: "Cannot reassign to a closed event." });
    }

    // Close the source.
    await tx.eventAssignment.update({ where: { id: source.id }, data: { removedAt: new Date() } });

    const existingTarget = await tx.eventAssignment.findFirst({
      where: { eventId: targetEventId, volunteerMembershipId: source.volunteerMembershipId },
    });

    let newAssignmentId: string;
    if (existingTarget) {
      // Reactivate the destination row instead of duplicating.
      await tx.eventAssignment.update({
        where: { id: existingTarget.id },
        data: { status: "ASSIGNED", removedAt: null, completedAt: null },
      });
      newAssignmentId = existingTarget.id;
    } else {
      const created = await tx.eventAssignment.create({
        data: {
          eventId: targetEventId,
          volunteerMembershipId: source.volunteerMembershipId,
          status: "ASSIGNED",
          assignedByAppUserId: actorAppUserId,
        },
      });
      newAssignmentId = created.id;
    }

    await tx.assignmentHistory.create({
      data: {
        assignmentId: newAssignmentId,
        actorAppUserId,
        action: "REASSIGNED",
        fromEventId: source.eventId,
        toEventId: targetEventId,
        fromStatus: source.status,
        toStatus: "ASSIGNED",
        requestId,
      },
    });

    await writeAudit(tx, {
      actorAppUserId,
      action: "ASSIGNMENT_REASSIGNED",
      targetType: "EventAssignment",
      targetId: newAssignmentId,
      domainId,
      requestId,
      before: { eventId: source.eventId },
      after: { eventId: targetEventId },
    });
  });
}
