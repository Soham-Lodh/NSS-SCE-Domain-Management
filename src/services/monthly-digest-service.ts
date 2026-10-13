import "server-only";

import { prisma } from "@/lib/db/prisma";
import { enqueueEmail } from "@/lib/email/outbox";
import { writeAudit } from "@/lib/audit/write-audit";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { monthKeyFor, monthStartInZone } from "@/lib/email/digest-policy";

export type MonthlyDigestRunResult = {
  digestsQueued: number;
  monthKey: string;
  skippedAlreadyQueued: number;
};

export { monthKeyFor };

/** Start-of-month grace period: the job may run daily but only enqueues within these days of month start. */
const GRACE_DAYS = 3;

/**
 * Monthly task summary ("monthly agile reminder").
 *
 * One consolidated email per eligible member at the start of each month,
 * listing every still-open assignment (ASSIGNED, not removed) on a SCHEDULED
 * event — future tasks and overdue-but-open tasks. Completed/removed
 * assignments and completed/cancelled/archived events are excluded. Reaching
 * the deadline never auto-completes anything.
 *
 * Idempotency: one outbox row per (recipient, monthKey) via the unique
 * idempotency key `monthly-digest:<monthKey>:<email>`. A daily scheduler is
 * safe because duplicate runs hit the unique key and skip.
 */
export async function runMonthlyDigest(now: Date = new Date()): Promise<MonthlyDigestRunResult> {
  const timeZone = serverEnv().ORGANIZATION_TIMEZONE;
  const monthKey = monthKeyFor(now, timeZone);

  // Find the 1st of the current month (org tz) and enforce the grace window.
  const monthStart = monthStartInZone(now, timeZone);
  const withinGrace = now.getTime() - monthStart.getTime() <= GRACE_DAYS * 24 * 60 * 60 * 1000;
  if (!withinGrace) {
    return { digestsQueued: 0, monthKey, skippedAlreadyQueued: 0 };
  }

  // Eligible recipients: people who currently hold an open assignment on a
  // SCHEDULED event. Bounded — the majority of org activity is recent.
  const assignments = await prisma.eventAssignment.findMany({
    where: {
      status: "ASSIGNED",
      removedAt: null,
      event: { status: "SCHEDULED" },
    },
    select: {
      id: true,
      eventId: true,
      membership: {
        select: {
          id: true,
          isActive: true,
          person: { select: { id: true, fullName: true, emailNormalized: true } },
        },
      },
      event: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          startAt: true,
          endAt: true,
          domain: { select: { name: true } },
        },
      },
    },
    take: 2000,
  });

  const byPerson = new Map<
    string,
    {
      person: { id: string; fullName: string; emailNormalized: string };
      tasks: Array<{
        title: string;
        domain: string;
        startAt: Date;
        endAt: Date;
        location: string | null;
        description: string | null;
      }>;
    }
  >();

  for (const a of assignments) {
    if (!a.membership.isActive) continue;
    const personId = a.membership.person.id;
    const entry = byPerson.get(personId) ?? {
      person: a.membership.person,
      tasks: [],
    };
    entry.tasks.push({
      title: a.event.title,
      domain: a.event.domain?.name ?? "",
      startAt: a.event.startAt,
      endAt: a.event.endAt,
      location: a.event.location,
      description: a.event.description,
    });
    byPerson.set(personId, entry);
  }

  let digestsQueued = 0;
  let skippedAlreadyQueued = 0;

  for (const { person, tasks } of byPerson.values()) {
    // Sort by nearest deadline first, then start time, then title.
    tasks.sort((x, y) =>
      x.endAt.getTime() - y.endAt.getTime() ||
      x.startAt.getTime() - y.startAt.getTime() ||
      x.title.localeCompare(y.title),
    );

    const queued = await prisma.$transaction(async (tx) => {
      const existing = await tx.emailOutbox.findFirst({
        where: { idempotencyKey: `monthly-digest:${monthKey}:${person.emailNormalized}` },
        select: { id: true, status: true },
      });
      if (existing) return false;

      await enqueueEmail(tx, {
        eventType: "MONTHLY_DIGEST",
        templateKey: "MONTHLY_DIGEST",
        recipient: person.emailNormalized,
        payload: {
          fullName: person.fullName,
          monthKey,
          taskCount: tasks.length,
          events: tasks.map((t) => ({
            event: t.title,
            domain: t.domain,
            startAt: t.startAt.toISOString(),
            deadline: t.endAt.toISOString(),
            ...(t.location ? { location: t.location } : {}),
            ...(t.description ? { description: t.description } : {}),
          })),
        },
        idempotencyKey: `monthly-digest:${monthKey}:${person.emailNormalized}`,
      });

      await writeAudit(tx, {
        actorAppUserId: null,
        action: "MONTHLY_DIGEST_QUEUED",
        targetType: "EmailOutbox",
        targetId: null,
        outcome: "SUCCESS",
        after: {
          monthKey,
          recipient: person.emailNormalized,
          taskCount: tasks.length,
        },
      });
      return true;
    }).catch((err: unknown) => {
      logger.warn("monthly_digest_enqueue_failed", {
        recipient: person.emailNormalized,
        message: err instanceof Error ? err.message : "unknown",
      });
      return false;
    });

    if (queued) digestsQueued += 1;
    else skippedAlreadyQueued += 1;
  }

  return { digestsQueued, monthKey, skippedAlreadyQueued };
}
