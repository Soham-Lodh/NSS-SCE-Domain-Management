import "server-only";

import { prisma } from "@/lib/db/prisma";
import { enqueueEmail } from "@/lib/email/outbox";
import { logger } from "@/lib/observability/logger";

const DAY = 24 * 60 * 60 * 1000;
const FOUR_DAYS = 4 * DAY;
const ONE_DAY = DAY;

export type ReminderRunResult = {
  fourDayEvents: number;
  oneDayEvents: number;
  emailsQueued: number;
};

/**
 * Deadline reminders. Scans SCHEDULED events whose deadline (`endAt`) falls
 * within 4 days / 24 hours and queues a reminder email to each assigned
 * volunteer. Idempotent: `reminder4dSentAt` / `reminder24hSentAt` plus a unique
 * outbox idempotency key guarantee at most one reminder per person per stage.
 *
 * Reaching the deadline does NOT end the event — only a domain lead can.
 */
export async function runDeadlineReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const fourDayEnd = new Date(now.getTime() + FOUR_DAYS);
  const oneDayEnd = new Date(now.getTime() + ONE_DAY);

  const baseWhere = {
    status: "SCHEDULED" as const,
    endAt: { gt: now },
    assignments: { some: { removedAt: null } },
  };

  const [fourDayEvents, oneDayEvents] = await Promise.all([
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
  ]);

  let emailsQueued = 0;

  for (const [stage, events] of [
    ["4d", fourDayEvents] as const,
    ["24h", oneDayEvents] as const,
  ]) {
    for (const event of events) {
      const daysLeft = Math.max(0, Math.round((event.endAt.getTime() - now.getTime()) / DAY));
      try {
        const queued = await prisma.$transaction(async (tx) => {
          let n = 0;
          for (const a of event.assignments) {
            await enqueueEmail(tx, {
              eventType: stage === "4d" ? "EVENT_REMINDER_4D" : "EVENT_REMINDER_24H",
              templateKey: stage === "4d" ? "EVENT_REMINDER_4D" : "EVENT_REMINDER_24H",
              recipient: a.membership.person.emailNormalized,
              payload: {
                fullName: a.membership.person.fullName,
                event: event.title,
                deadline: event.endAt.toISOString(),
                daysLeft,
              },
              idempotencyKey: `reminder-${stage}:${event.id}:${a.id}`,
            });
            n += 1;
          }
          await tx.event.update({
            where: { id: event.id },
            data:
              stage === "4d"
                ? { reminder4dSentAt: now }
                : { reminder24hSentAt: now },
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
    emailsQueued,
  };
}

const eventSelect = {
  id: true,
  title: true,
  endAt: true,
  assignments: {
    where: { removedAt: null },
    select: {
      id: true,
      membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } },
    },
  },
} as const;
