import "server-only";

import { Prisma } from "@prisma/client";
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
 * <assignmentId>`) is the single per-person/stage guarantee. Event-level
 * `reminder*SentAt` stamps remain ONLY as scan optimizations (they stop
 * re-scanning an event whose CURRENT members were already queued); the
 * reactivation helper restores per-member coverage when somebody is (re)added
 * after such a stamp. Reaching the deadline does NOT end the event — only a
 * domain lead can.
 */
export async function runDeadlineReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const fourDayEnd = new Date(now.getTime() + FOUR_DAYS);
  const oneDayEnd = new Date(now.getTime() + ONE_DAY);

  // SINGLE indexed scan instead of three overlapping ones: the 4-day window is
  // the widest of the three, so one pass over (status = SCHEDULED, endAt in
  // (now, now+4d]) with an OR over the un-stamped reminder flags gives every
  // stage candidate in a single query. Stages are then classified in memory;
  // the query is served directly by the `events(status, end_at)` index and the
  // EXISTS on active assignments uses `event_assignments(event_id, status)`.
  const candidates = await prisma.event.findMany({
    where: {
      status: "SCHEDULED" as const,
      endAt: { gt: now, lte: fourDayEnd },
      OR: [{ reminder4dSentAt: null }, { reminder24hSentAt: null }],
      assignments: { some: { removedAt: null, status: "ASSIGNED" as const } },
    },
    select: { id: true, reminder4dSentAt: true, reminder24hSentAt: true, startAt: true, endAt: true },
    orderBy: { endAt: "asc" },
    take: 800,
  });

  // Classify per stage in memory (strictly narrower than the fetched window).
  const fourDayEvents: string[] = [];
  const oneDayEvents: string[] = [];
  for (const c of candidates) {
    if (!c.reminder4dSentAt && c.endAt.getTime() <= fourDayEnd.getTime()) fourDayEvents.push(c.id);
    if (!c.reminder24hSentAt && c.endAt.getTime() <= oneDayEnd.getTime()) oneDayEvents.push(c.id);
  }

  // Fetch full event payloads (with active assignments) only for events that
  // actually reached a stage boundary, in one bounded batch per stage.
  const [loaded4d, loaded24h] = await Promise.all(
    [fourDayEvents, oneDayEvents].map(loadRemindableEvents),
  );

  let emailsQueued = 0;
  const missedByStage = { "4d": 0, "24h": 0 };

  for (const [stage, events] of [
    ["4d", loaded4d] as const,
    ["24h", loaded24h] as const,
  ]) {
    const windowMs = stage === "4d" ? FOUR_DAYS : ONE_DAY;
    const tolerance = STAGE_TOLERANCE_MS[stage];

    for (const event of events.slice(0, 200)) {
      // Very short events are record-only for reminder purposes. Assignment
      // confirmation mail is still sent, but no deadline reminder is queued.
      if (event.startAt && event.endAt && event.endAt.getTime() - event.startAt.getTime() <= ONE_HOUR) {
        continue;
      }
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
            const eventType = stage === "4d" ? "EVENT_REMINDER_4D" : "EVENT_REMINDER_24H";
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
                daysLeft,
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
    oneHourEvents: 0,
    fourDayMissed: missedByStage["4d"],
    oneDayMissed: missedByStage["24h"],
    oneHourMissed: 0,
    emailsQueued,
  };
}

function stageField(stage: string, at: Date) {
  if (stage === "4d") return { reminder4dSentAt: at };
  if (stage === "24h") return { reminder24hSentAt: at };
  return { reminder1hSentAt: at };
}

/**
 * When an assignment is (re)activated while an event-level reminder stamp is
 * ALREADY set, the reminder scan would skip that event entirely and the new
 * member would silently miss the due stage(s). This helper is called inside
 * the same business transaction as the (re)activation and enqueues every
 * reminder stage that is currently due for THIS assignment — the per-membership
 * outbox idempotency key (`reminder-<stage>:<event>:<assignment>`) guarantees
 * each stage is still delivered at most once, so keys that already exist no-op.
 * Stages whose window is closed under the missed-stage tolerance are skipped.
 */
export async function queueDueRemindersForReactivatedAssignment(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startAt: Date;
    endAt: Date;
    domainId: string;
    domain: { name: string } | null;
  },
  assignmentId: string,
  person: { fullName: string; emailNormalized: string },
): Promise<void> {
  // Short events may still send the assignment confirmation, but never send
  // deadline reminders (including the legacy 1-hour stage).
  if (event.endAt.getTime() - event.startAt.getTime() <= ONE_HOUR) return;
  const now = Date.now();
  for (const [stage, windowMs, typeName] of [
    ["4d", FOUR_DAYS, "EVENT_REMINDER_4D"],
    ["24h", ONE_DAY, "EVENT_REMINDER_24H"],
  ] as const) {
    const stageDueAt = event.endAt.getTime() - windowMs;
    if (now < stageDueAt) continue; // window not open yet — scan will queue it
    if (now >= event.endAt.getTime()) continue; // deadline passed
    if (now - stageDueAt > STAGE_TOLERANCE_MS[stage]) continue; // stage missed
    await enqueueEmail(tx, {
      eventType: typeName,
      templateKey: typeName,
      recipient: person.emailNormalized,
      payload: {
        fullName: person.fullName,
        event: event.title,
        domain: event.domain?.name ?? "",
        startAt: event.startAt.toISOString(),
        deadline: event.endAt.toISOString(),
        daysLeft: Math.max(0, Math.round((event.endAt.getTime() - now) / DAY)),
        ...(event.description ? { description: event.description } : {}),
        ...(event.location ? { location: event.location } : {}),
        eventId: event.id,
        assignmentId,
        domainId: event.domainId,
      },
      idempotencyKey: `reminder-${stage}:${event.id}:${assignmentId}`,
    });
  }
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

type RemindableEvent = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

/** Batch-load full reminder payloads for a bounded list of event ids. */
function loadRemindableEvents(ids: string[]): Promise<RemindableEvent[]> {
  return ids.length === 0
    ? Promise.resolve([])
    : prisma.event.findMany({
        where: { id: { in: ids } },
        select: eventSelect,
        orderBy: { id: "asc" },
        take: 200,
      });
}
