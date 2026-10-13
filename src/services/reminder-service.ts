import "server-only";

import { prisma } from "@/lib/db/prisma";
import { enqueueEmail } from "@/lib/email/outbox";
import { writeAudit } from "@/lib/audit/write-audit";
import { logger } from "@/lib/observability/logger";

const DAY = 24 * 60 * 60 * 1000;
const FOUR_DAYS = 4 * DAY;
const ONE_DAY = DAY;
const ONE_HOUR = 60 * 60 * 1000;

export type ReminderRunResult = {
  fourDayEvents: number;
  oneDayEvents: number;
  oneHourEvents: number;
  emailsQueued: number;
};

/**
 * Deadline reminders. Scans SCHEDULED events whose deadline (`endAt`) falls
 * within 4 days / 24 hours / 1 hour and queues a reminder email to each
 * assigned volunteer whose assignment has NOT been completed or removed.
 *
 * Idempotent: `reminder4dSentAt` / `reminder24hSentAt` / `reminder1hSentAt`
 * plus a unique outbox idempotency key guarantee at most one reminder per
 * person per stage.
 *
 * Suppression rules:
 * - Only SCHEDULED events receive reminders (COMPLETED / CANCELLED / ARCHIVED
 *   are silently skipped).
 * - Only volunteers with status=ASSIGNED and removedAt=null receive reminders.
 *   If a lead marks an assignment completed, removes a member, ends the event,
 *   or cancels it, no further reminders are sent.
 * - Future tasks: reminders fire only when `now + window >= endAt`, meaning the
 *   deadline has actually entered the reminder window. An event created far in
 *   advance won't trigger emails until the window arrives.
 *
 * Reaching the deadline does NOT end the event — only a domain lead can.
 */
export async function runDeadlineReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const fourDayEnd = new Date(now.getTime() + FOUR_DAYS);
  const oneDayEnd = new Date(now.getTime() + ONE_DAY);
  const oneHourEnd = new Date(now.getTime() + ONE_HOUR);

  // Only SCHEDULED events with at least one active (non-removed, non-completed)
  // assignment. Completed/cancelled/archived events are excluded.
  const baseWhere = {
    status: "SCHEDULED" as const,
    endAt: { gt: now },
    assignments: { some: { removedAt: null, status: "ASSIGNED" as const } },
  };

  const [fourDayEvents, oneDayEvents, oneHourEvents] = await Promise.all([
    prisma.event.findMany({
      where: { ...baseWhere, reminder4dSentAt: null, endAt: { gt: now, lte: fourDayEnd } },
      select: eventSelect,
      take: 200,
    }),
    prisma.event.findMany({
      where: { ...baseWhere, reminder24hSentAt: null, endAt: { gt: now, lte: oneDayEnd } },
      select: eventSelect,
      take: 200,
    }),
    prisma.event.findMany({
      where: { ...baseWhere, reminder1hSentAt: null, endAt: { gt: now, lte: oneHourEnd } },
      select: eventSelect,
      take: 200,
    }),
  ]);

  let emailsQueued = 0;

  for (const [stage, events] of [
    ["4d", fourDayEvents] as const,
    ["24h", oneDayEvents] as const,
    ["1h", oneHourEvents] as const,
  ]) {
    for (const event of events) {
      const msLeft = Math.max(0, event.endAt.getTime() - now.getTime());
      const daysLeft = Math.max(0, Math.round(msLeft / DAY));
      const hoursLeft = Math.max(0, Math.round(msLeft / ONE_HOUR));
      try {
        const queued = await prisma.$transaction(async (tx) => {
          let n = 0;
          for (const a of event.assignments) {
            const eventType = stage === "4d" ? "EVENT_REMINDER_4D"
              : stage === "24h" ? "EVENT_REMINDER_24H"
              : "EVENT_REMINDER_1H";
            const templateKey = eventType;
            await enqueueEmail(tx, {
              eventType,
              templateKey,
              recipient: a.membership.person.emailNormalized,
              payload: {
                fullName: a.membership.person.fullName,
                event: event.title,
                domain: event.domain.name,
                startAt: event.startAt.toISOString(),
                deadline: event.endAt.toISOString(),
                ...(stage === "1h" ? { hoursLeft } : { daysLeft }),
                ...(event.description ? { description: event.description } : {}),
                ...(event.location ? { location: event.location } : {}),
                eventId: event.id,
                assignmentId: a.id,
                domainId: event.domainId,
              },
              idempotencyKey: `reminder-${stage}:${event.id}:${a.id}`,
            });
            n += 1;
          }

          const sentField = stage === "4d"
            ? { reminder4dSentAt: now }
            : stage === "24h"
            ? { reminder24hSentAt: now }
            : { reminder1hSentAt: now };

          await tx.event.update({
            where: { id: event.id },
            data: sentField,
          });

          // Audit log the reminder batch — visible to tech team and coordinator.
          await writeAudit(tx, {
            actorAppUserId: null,
            action: `REMINDER_SENT_${stage.toUpperCase()}`,
            targetType: "Event",
            targetId: event.id,
            domainId: event.domainId,
            after: {
              stage,
              eventTitle: event.title,
              recipientCount: n,
              deadline: event.endAt.toISOString(),
            },
          });

          return n;
        });
        emailsQueued += queued;
      } catch (err) {
        logger.warn("reminder_enqueue_failed", {
          eventId: event.id,
          stage,
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  return {
    fourDayEvents: fourDayEvents.length,
    oneDayEvents: oneDayEvents.length,
    oneHourEvents: oneHourEvents.length,
    emailsQueued,
  };
}

/**
 * Select only active assignments (not completed, not removed) so completed or
 * removed volunteers never receive reminder emails.
 */
const eventSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  startAt: true,
  endAt: true,
  domainId: true,
  domain: { select: { name: true } },
  assignments: {
    where: { removedAt: null, status: "ASSIGNED" as const },
    select: {
      id: true,
      membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } },
    },
  },
} as const;
