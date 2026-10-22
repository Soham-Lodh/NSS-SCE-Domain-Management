import "server-only";

import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/write-audit";
import { enqueueEmail, suppressOutboxFor } from "@/lib/email/outbox";
import { withBusinessTx, lockingTx } from "@/lib/db/tx";
import { queueDueRemindersForReactivatedAssignment } from "@/services/reminder-service";

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
 * Concurrency (strict 2PL, global lock order):
 *   Event row → sorted VolunteerMembership rows → sorted existing assignment
 *   rows → business writes → COMMIT (PostgreSQL releases the locks).
 *
 * - Event and every membership are validated to belong to the domain AFTER the
 *   locks are held; the DB unique (event_id, volunteer_membership_id)
 *   constraint remains the final duplicate-credit guard.
 * - Removed rows are REACTIVATED (never duplicated): one new assignment
 *   confirmation + start notice per legitimate reactivation, keyed so repeated
 *   calls cannot duplicate emails or history.
 * - An assignment confirmation email is enqueued INSIDE this transaction and
 *   delivered immediately after commit — for future events too. A separate
 *   EVENT_STARTED notice rides the outbox until the event's scheduled start.
 */
export async function bulkAssign(args: {
  eventId: string;
  domainId: string;
  membershipIds: string[];
  actorAppUserId: string;
  requestId: string;
}): Promise<BulkAssignSummary> {
  const { eventId, domainId, membershipIds, actorAppUserId, requestId } = args;

  return withBusinessTx(
    prisma,
    async (rawTx) => {
      const tx = lockingTx(rawTx);

      // The event must exist in this domain before we lock anything.
      const eventRef = await tx.event.findFirst({
        where: { id: eventId, domainId },
        select: { id: true },
      });
      if (!eventRef) throw notFound("Event not found.");

      // Lock order step 1 — the owning event row.
      await tx.lockEvent(eventId);

      // Lock order step 2 — every requested membership row (sorted, unique).
      const uniqueIds = Array.from(new Set(membershipIds));
      await tx.lockMemberships(uniqueIds);

      // Validate AFTER locking: do they exist, belong here and stay active?
      const memberships = await tx.volunteerMembership.findMany({
        where: { id: { in: uniqueIds }, domainId, isActive: true },
        select: { id: true, person: { select: { fullName: true, emailNormalized: true } } },
      });
      const valid = new Map(memberships.map((m) => [m.id, m]));

      // Lock order step 3 — existing assignment rows for these memberships.
      const existing = await tx.eventAssignment.findMany({
        where: { eventId, volunteerMembershipId: { in: uniqueIds } },
        select: { id: true, volunteerMembershipId: true, removedAt: true },
      });
      await tx.lockAssignments(existing.map((e) => e.id));

      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          id: true, domainId: true, title: true, status: true,
          description: true, startAt: true, endAt: true, location: true,
          reminder4dSentAt: true, reminder24hSentAt: true, reminder1hSentAt: true,
          domain: { select: { name: true } },
        },
      });
      if (!event) throw notFound("Event not found.");
      // Re-validated while the event row lock is still held — an event that a
      // concurrent lead ended/cancelled is rejected here, not half-assigned.
      if (event.status !== "SCHEDULED") {
        throw validationError({ eventId: "Reopen the event before changing assignments." });
      }

      const results: BulkAssignOutcome[] = [];
      const toCreate: string[] = [];
      const toReactivate: string[] = [];

      for (const membershipId of uniqueIds) {
        if (!valid.has(membershipId)) {
          results.push({
            membershipId,
            result: "rejected",
            reason: "Not an active member of this domain.",
          });
          continue;
        }
        const current = existing.find((e) => e.volunteerMembershipId === membershipId);
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
        // skipDuplicates defends against a concurrent identical request racing
        // past the row locks (no-op thanks to the unique constraint).
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
          select: { id: true, volunteerMembershipId: true, assignedAt: true },
        });
        const assignedByMembership = new Map(
          assignedRows.map((r) => [r.volunteerMembershipId, r]),
        );

        // One valid transition per newly-assigned (re)activation; a repeated
        // identical call already returned already_assigned above, so history
        // cannot be duplicated for an unchanged operation.
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

        // Resolve the assigner's name for the email.
        const assigner = await tx.appUser.findUnique({
          where: { id: actorAppUserId },
          select: { person: { select: { fullName: true } } },
        });
        const assignerName = assigner?.person.fullName ?? "A domain lead";

        for (const membershipId of assignedMembershipIds) {
          const m = valid.get(membershipId)!;
          const row = assignedByMembership.get(membershipId)!;

          // Transition-aware idempotency key: a genuine reactivation (assignedAt
          // updated) produces a NEW confirmation; retries/concurrency no-op.
          const confirmationKey = `event-assigned:${eventId}:${membershipId}:${row.assignedAt.getTime()}`;
          await enqueueEmail(tx, {
            eventType: "EVENT_ASSIGNED",
            templateKey: "EVENT_ASSIGNED",
            recipient: m.person.emailNormalized,
            payload: {
              fullName: m.person.fullName,
              event: event.title,
              domain: event.domain.name,
              assignedBy: assignerName,
              startAt: event.startAt.toISOString(),
              endAt: event.endAt.toISOString(),
              ...(event.description ? { description: event.description } : {}),
              ...(event.location ? { location: event.location } : {}),
              eventId,
              assignmentId: row.id,
              domainId,
              volunteerMembershipId: membershipId,
            },
            idempotencyKey: confirmationKey,
          });

          // Separate start-time notice: one per assignment, deferred until the
          // event's scheduled start (already started ⇒ eligible immediately).
          const startKey = `event-started:${eventId}:${row.id}`;
          await enqueueEmail(tx, {
            eventType: "EVENT_STARTED",
            templateKey: "EVENT_STARTED",
            recipient: m.person.emailNormalized,
            payload: {
              fullName: m.person.fullName,
              event: event.title,
              domain: event.domain.name,
              startAt: event.startAt.toISOString(),
              deadline: event.endAt.toISOString(),
              ...(event.description ? { description: event.description } : {}),
              ...(event.location ? { location: event.location } : {}),
              eventId,
              assignmentId: row.id,
              domainId,
              volunteerMembershipId: membershipId,
            },
            idempotencyKey: startKey,
            ...(event.startAt.getTime() > Date.now() ? { nextAttemptAt: event.startAt } : {}),
          });

          // If the member was re-added while reminder stages are already due
          // (event-level stamps must not suppress THEIR stage), enqueuing the
          // due stages here with per-assignment keys restores per-member
          // correctness. Idempotency keys make repeat calls no-ops.
          await queueDueRemindersForReactivatedAssignment(tx, event, row.id, m.person);
        }
      }

      // Lock order step 4/files: audit in the same transaction.
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
          requested: uniqueIds.length,
        },
      });

      const assigned = results.filter((r) => r.result === "assigned").length;
      const alreadyAssigned = results.filter((r) => r.result === "already_assigned").length;
      const rejected = results.filter((r) => r.result === "rejected").length;
      return { assigned, alreadyAssigned, rejected, results };
    },
    { requestId, action: "bulkAssign" },
  );
}

/**
 * Marks one assignment completed. Idempotent — at most one completion credit.
 * No completion email exists by design; still-pending assignment/start/reminder
 * mail for this assignment is atomically suppressed in the same transaction.
 */
export async function completeAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await withBusinessTx(
    prisma,
    async (rawTx) => {
      const tx = lockingTx(rawTx);

      const ref = await tx.eventAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, eventId: true },
      });
      if (!ref) throw notFound("Assignment not found.");

      // Lock order: event row, then the assignment row.
      await tx.lockEvent(ref.eventId);
      await tx.lockAssignments([assignmentId]);

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

      // No more mail about this task for this member (atomic, same tx).
      await suppressOutboxFor(tx, {
        assignmentId,
        reason: "The assignment was completed before delivery.",
      });
    },
    { requestId, action: "completeAssignment" },
  );
}

/** Reopens a completed assignment (reverses a completion). */
export async function reopenAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await withBusinessTx(
    prisma,
    async (rawTx) => {
      const tx = lockingTx(rawTx);

      const ref = await tx.eventAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, eventId: true },
      });
      if (!ref) throw notFound("Assignment not found.");

      await tx.lockEvent(ref.eventId);
      await tx.lockAssignments([assignmentId]);

      const assignment = await tx.eventAssignment.findFirst({
        where: { id: assignmentId, removedAt: null, event: { domainId } },
        select: {
          id: true,
          status: true,
          eventId: true,
          volunteerMembershipId: true,
          event: {
            select: {
              id: true, status: true, title: true, description: true, location: true,
              startAt: true, endAt: true, domainId: true,
              domain: { select: { name: true } },
              reminder4dSentAt: true, reminder24hSentAt: true, reminder1hSentAt: true,
            },
          },
          membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } },
        },
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

      // A reopened assignment is mailed like a reactivation: confirmation,
      // start notice, and any reminder stage that is due RIGHT NOW (later
      // stages fire from the reminder scan as usual).
      const person = assignment.membership.person;
      await enqueueEmail(tx, {
        eventType: "EVENT_ASSIGNED",
        templateKey: "EVENT_ASSIGNED",
        recipient: person.emailNormalized,
        payload: {
          fullName: person.fullName,
          event: assignment.event.title,
          domain: assignment.event.domain.name,
          startAt: assignment.event.startAt.toISOString(),
          endAt: assignment.event.endAt.toISOString(),
          ...(assignment.event.description ? { description: assignment.event.description } : {}),
          ...(assignment.event.location ? { location: assignment.event.location } : {}),
          eventId: assignment.eventId,
          assignmentId,
          domainId,
          volunteerMembershipId: assignment.volunteerMembershipId,
        },
        idempotencyKey: `event-assigned-reopen:${assignmentId}:${Date.now()}`,
      });
      await enqueueEmail(tx, {
        eventType: "EVENT_STARTED",
        templateKey: "EVENT_STARTED",
        recipient: person.emailNormalized,
        payload: {
          fullName: person.fullName,
          event: assignment.event.title,
          domain: assignment.event.domain.name,
          startAt: assignment.event.startAt.toISOString(),
          deadline: assignment.event.endAt.toISOString(),
          eventId: assignment.eventId,
          assignmentId,
          domainId,
          volunteerMembershipId: assignment.volunteerMembershipId,
        },
        idempotencyKey: `event-started-reopen:${assignmentId}:${Date.now()}`,
        ...(assignment.event.startAt.getTime() > Date.now()
          ? { nextAttemptAt: assignment.event.startAt }
          : {}),
      });
      await queueDueRemindersForReactivatedAssignment(
        tx,
        assignment.event,
        assignmentId,
        person,
      );
    },
    { requestId, action: "reopenAssignment" },
  );
}

/**
 * Soft-removes an assignment by stamping removedAt. The row is retained so
 * re-adding the same volunteer reactivates it — a single current-state row per
 * (event, membership) means no duplicate credit is ever possible.
 *
 * NO removal email is sent (product rule): the member simply stops receiving
 * mail about this event. Every still-pending outbox message for the
 * assignment is atomically suppressed in this same transaction, so the
 * delivery-time policy is the second guard, not the only guard.
 */
export async function removeAssignment(args: {
  assignmentId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, domainId, actorAppUserId, requestId } = args;
  await withBusinessTx(
    prisma,
    async (rawTx) => {
      const tx = lockingTx(rawTx);

      const ref = await tx.eventAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, eventId: true },
      });
      if (!ref) throw notFound("Assignment not found.");

      await tx.lockEvent(ref.eventId);
      await tx.lockAssignments([assignmentId]);

      const assignment = await tx.eventAssignment.findFirst({
        where: { id: assignmentId, removedAt: null, event: { domainId } },
        select: {
          id: true,
          status: true,
          eventId: true,
          volunteerMembershipId: true,
          event: { select: { status: true, title: true } },
          membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } },
        },
      });
      if (!assignment) throw notFound("Assignment not found.");
      if (assignment.event.status !== "SCHEDULED") {
        throw validationError({ assignmentId: "Reopen the event before changing assignments." });
      }

      // Idempotent by-state: an already-removed assignment is a no-op (the
      // first removal already stamped removedAt and suppressed the mail).
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

      await suppressOutboxFor(tx, {
        assignmentId,
        reason: "The member was removed from the event before delivery.",
      });
    },
    { requestId, action: "removeAssignment" },
  );
}

/**
 * Atomically moves a membership's assignment to another event in the same
 * domain, preserving history. Lock order: BOTH event rows in ascending id
 * order first (so a concurrent bulkAssign on either event waits on the same
 * global order), then the assignment rows.
 */
export async function reassignAssignment(args: {
  assignmentId: string;
  targetEventId: string;
  domainId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { assignmentId, targetEventId, domainId, actorAppUserId, requestId } = args;

  await withBusinessTx(
    prisma,
    async (rawTx) => {
      const tx = lockingTx(rawTx);

      const sourceRef = await tx.eventAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, eventId: true },
      });
      if (!sourceRef) throw notFound("Assignment not found.");

      // Deterministic two-event lock order.
      const bothEvents = [sourceRef.eventId, targetEventId].sort();
      for (const id of bothEvents) await tx.lockEvent(id);
      await tx.lockAssignments([assignmentId]);

      const source = await tx.eventAssignment.findFirst({
        where: { id: assignmentId, removedAt: null, event: { domainId } },
        select: {
          id: true,
          eventId: true,
          status: true,
          volunteerMembershipId: true,
          event: { select: { status: true } },
          membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } },
        },
      });
      if (!source) throw notFound("Assignment not found.");
      if (source.event.status !== "SCHEDULED") {
        throw validationError({ assignmentId: "Reopen the event before changing assignments." });
      }
      if (source.eventId === targetEventId) {
        throw validationError({ targetEventId: "Already assigned to that event." });
      }

      const target = await tx.event.findUnique({
        where: { id: targetEventId },
        select: {
          id: true, domainId: true, title: true, status: true,
          description: true, startAt: true, endAt: true, location: true,
          domain: { select: { name: true } },
        },
      });
      if (!target || target.domainId !== domainId) throw notFound("Target event not found.");
      // Re-validated while the event row locks are held.
      if (target.status !== "SCHEDULED") {
        throw validationError({ targetEventId: "Cannot reassign to a closed event." });
      }

      const now = new Date();
      // Close the source assignment (no removal email — the person gets the
      // new assignment's emails instead, and the suppression keeps any queued
      // source-event mail from slipping out afterwards).
      await tx.eventAssignment.update({ where: { id: source.id }, data: { removedAt: now } });

      const existingTarget = await tx.eventAssignment.findFirst({
        where: { eventId: targetEventId, volunteerMembershipId: source.volunteerMembershipId },
      });
      await tx.lockAssignments(existingTarget ? [existingTarget.id] : []);

      let newAssignmentId: string;
      if (existingTarget) {
        await tx.eventAssignment.update({
          where: { id: existingTarget.id },
          data: { status: "ASSIGNED", removedAt: null, completedAt: null, assignedAt: now, assignedByAppUserId: actorAppUserId },
        });
        newAssignmentId = existingTarget.id;
      } else {
        const created = await tx.eventAssignment.create({
          data: {
            eventId: targetEventId,
            volunteerMembershipId: source.volunteerMembershipId,
            status: "ASSIGNED",
            assignedByAppUserId: actorAppUserId,
            assignedAt: now,
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

      await suppressOutboxFor(tx, {
        assignmentId: source.id,
        reason: "The member was moved to another event.",
      });

      const person = source.membership.person;
      const assigner = await tx.appUser.findUnique({
        where: { id: actorAppUserId },
        select: { person: { select: { fullName: true } } },
      });
      // Immediate confirmation for the NEW assignment (delivered right after
      // commit, for future events too — no waiting for the target start time).
      await enqueueEmail(tx, {
        eventType: "EVENT_ASSIGNED",
        templateKey: "EVENT_ASSIGNED",
        recipient: person.emailNormalized,
        payload: {
          fullName: person.fullName,
          event: target.title,
          domain: target.domain.name,
          assignedBy: assigner?.person.fullName ?? "A domain lead",
          startAt: target.startAt.toISOString(),
          endAt: target.endAt.toISOString(),
          ...(target.description ? { description: target.description } : {}),
          ...(target.location ? { location: target.location } : {}),
          eventId: targetEventId,
          assignmentId: newAssignmentId,
          domainId,
          volunteerMembershipId: source.volunteerMembershipId,
        },
        idempotencyKey: `event-assigned:${targetEventId}:${source.volunteerMembershipId}:${now.getTime()}`,
      });
      await enqueueEmail(tx, {
        eventType: "EVENT_STARTED",
        templateKey: "EVENT_STARTED",
        recipient: person.emailNormalized,
        payload: {
          fullName: person.fullName,
          event: target.title,
          domain: target.domain.name,
          startAt: target.startAt.toISOString(),
          deadline: target.endAt.toISOString(),
          ...(target.description ? { description: target.description } : {}),
          ...(target.location ? { location: target.location } : {}),
          eventId: targetEventId,
          assignmentId: newAssignmentId,
          domainId,
          volunteerMembershipId: source.volunteerMembershipId,
        },
        idempotencyKey: `event-started:${targetEventId}:${newAssignmentId}`,
        ...(target.startAt.getTime() > now.getTime() ? { nextAttemptAt: target.startAt } : {}),
      });
    },
    { requestId, action: "reassignAssignment" },
  );
}
