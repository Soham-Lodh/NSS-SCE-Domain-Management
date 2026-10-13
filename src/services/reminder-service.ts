import "server-only";

import { prisma } from "@/lib/db/prisma";
import { enqueueEmail } from "@/lib/email/outbox";
import { writeAudit } from "@/lib/audit/write-audit";
import { logger } from "@/lib/observability/logger";

const DAY = 24 * 60 * 60 * 1000;
const FOUR_DAYS = 4 * DAY;
const ONE_DAY = DAY;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Tolerances for missed stages. A stage that became due long ago (worker was
 * down / scheduler missed) is marked missed and NOT sent in a stale burst once
 * the window plus its tolerance has passed; its outbox rows, if any were enued,
 * will be suppressed by the shared delivery policy. Later stages still fire.
 */
const STAGE_TOLERANCE_MS: Record<string, number> = {
  "4d": 12 * ONE_HOUR, // scheduled at start-of-window; tolerate half a day of downtime
  "24h": 3 * ONE_HOUR,
  "1h": 10 * 60_000,
};

export type ReminderRunResult = {
  fourDayEvents: number;
  oneDayEvents: number;
  oneHourEvents: number;
  fourDayMissed: number;
  oneDayMissed: number;
  oneHourMissed: number;
  emailsQueued: number;
};

/**
 * Deadline reminders. Scans SCHEDULED events whose deadline (`endAt`) enters
 * the 4-day / 24-hour / 1-hour window and queues one reminder per active
 * (status=ASSIGNED, removedAt=null) assignment.
 *
 * Idempotency: a unique outbox idempotency key (`reminder-<stage>:<eventId>:
 * <assignmentId>`) is the single per-person/stage guarantee, PLUS event-level
 * `reminder*SentAt` stamps that stop re-scanning. Reaching the deadline does
 * NOT end the event — only a domain lead can.
 */
export async function runDeadlineReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const fourDayEnd = new Date(now.getTime() + FOUR_DAYS);
  const oneDayEnd = new Date(now.getTime() + ONE_DAY);
  const oneHourEnd = new Date(now.getTime() + ONE_HOUR);

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
  const missedByStage = { "4d": 0, "24h": 0, "1h": 0 };

  for (const [stage, events] of [
    ["4d", fourDayEvents] as const,
    ["24h", oneDayEvents] as const,
    ["1h", oneHourEvents] as const,
  ]) {
    const windowMs = stage === "4d" ? FOUR_DAYS : stage === "24h" ? ONE_DAY : ONE_HOUR;
    const tolerance = STAGE_TOLERANCE_MS[stage];

    for (const event of events) {
      // Missed-window check: if the deadline is closer than (window - tolerance)
      // and this stage was never queued, the stage cannot retire on time.
      const stageDueAt = event.endAt.getTime() - windowMs;
      if (now.getTime() - stageDueAt > tolerance) {
        // Too late for this stage — stamp it and record a miss (no stale burst).
        await prisma.event.update({
          where: { id: event.id },
          data: stageField(stage, now),
        });
        await writeAudit(prisma, {
          actorAppUserId: null,
          action: `REMINDER_MISSED_${stage.toUpperCase()}`,
          targetType: "Event",
          targetId: event.id,
          domainId: event.domainId,
          outcome: "FAILURE",
          after: {
            stage,
            eventTitle: event.title,
            deadline: event.endAt.toISOString(),
            reason: "Stage window closed before the scheduler could run.",
          },
        });
        missedByStage[stage as keyof typeof missedByStage] += 1;
        continue;
      }

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

          await tx.event.update({
            where: { id: event.id },
            data: stageField(stage, now),
          });

          await writeAudit(tx, {
            actorAppUserId: null,
            action: `REMINDER_QUEUED_${stage.toUpperCase()}`,
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
    fourDayMissed: missedByStage["4d"],
    oneDayMissed: missedByStage["24h"],
    oneHourMissed: missedByStage["1h"],
    emailsQueued,
  };
}

function stageField(stage: string, at: Date) {
  if (stage === "4d") return { reminder4dSentAt: at };
  if (stage === "24h") return { reminder24hSentAt: at };
  return { reminder1hSentAt: at };
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
