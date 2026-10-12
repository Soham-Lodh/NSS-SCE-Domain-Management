import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notFound, validationError } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/write-audit";
import { enqueueEmail } from "@/lib/email/outbox";
import type { CreateEventInput } from "@/lib/validation/schemas";
import type { Paginated } from "@/lib/utils/pagination";
import type { DerivedEventCategory } from "@/lib/utils/datetime";

export type EventCard = {
  id: string;
  domainId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  endedAt: Date | null;
  category: DerivedEventCategory;
  assignedCount: number;
  completedCount: number;
};

export type EventCategoryFilter = "UPCOMING" | "ONGOING" | "PAST" | "COMPLETED" | "CANCELLED" | "ALL";

function categoryWhere(category: EventCategoryFilter, now: Date): Prisma.EventWhereInput {
  switch (category) {
    case "UPCOMING":
      return { status: { notIn: ["CANCELLED", "COMPLETED"] }, startAt: { gt: now } };
    case "ONGOING":
      return { status: { notIn: ["CANCELLED", "COMPLETED"] }, startAt: { lte: now }, endAt: { gt: now } };
    // Past = deadline passed but the task is STILL OPEN (not auto-completed).
    case "PAST":
      return { status: { notIn: ["CANCELLED", "COMPLETED"] }, endAt: { lte: now } };
    case "COMPLETED":
      return { status: "COMPLETED" };
    case "CANCELLED":
      return { status: "CANCELLED" };
    default:
      return {};
  }
}

function categoryOrder(category: EventCategoryFilter): Prisma.EventOrderByWithRelationInput[] {
  if (category === "PAST") return [{ endAt: "desc" }, { id: "asc" }];
  if (category === "COMPLETED") return [{ endedAt: "desc" }, { id: "asc" }];
  return [{ startAt: "desc" }, { id: "asc" }];
}

function deriveCategory(
  startAt: Date,
  endAt: Date,
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED",
  now: Date,
): DerivedEventCategory {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "COMPLETED") return "COMPLETED";
  if (now < startAt) return "UPCOMING";
  if (now < endAt) return "ONGOING";
  return "PAST";
}

/**
 * Domain-scoped event cards with assignment status summaries. Two bounded
 * queries per page (events + grouped assignment counts) — no N+1.
 */
export async function listEvents(args: {
  domainId: string;
  category: EventCategoryFilter;
  search?: string;
  page: number;
  limit: number;
}): Promise<Paginated<EventCard>> {
  const { domainId, category, search = "", page, limit } = args;
  const now = new Date();
  const where: Prisma.EventWhereInput = {
    domainId,
    ...categoryWhere(category, now),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { location: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, events] = await prisma.$transaction([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      select: {
        id: true,
        domainId: true,
        title: true,
        description: true,
        location: true,
        startAt: true,
        endAt: true,
        status: true,
        endedAt: true,
      },
      orderBy: categoryOrder(category),
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const ids = events.map((e) => e.id);
  const grouped = ids.length
    ? await prisma.eventAssignment.groupBy({
        by: ["eventId", "status"],
        where: { eventId: { in: ids }, removedAt: null },
        _count: { _all: true },
      })
    : [];

  const counts = new Map<string, { assigned: number; completed: number }>();
  for (const g of grouped) {
    const cur = counts.get(g.eventId) ?? { assigned: 0, completed: 0 };
    if (g.status === "COMPLETED") cur.completed += g._count._all;
    cur.assigned += g._count._all;
    counts.set(g.eventId, cur);
  }

  const items: EventCard[] = events.map((e) => {
    const c = counts.get(e.id) ?? { assigned: 0, completed: 0 };
    return {
      ...e,
      category: deriveCategory(e.startAt, e.endAt, e.status, now),
      assignedCount: c.assigned,
      completedCount: c.completed,
    };
  });

  return { items, page, limit, total, hasMore: page * limit < total };
}

export async function getEventDetail(domainId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, domainId },
    select: {
      id: true,
      domainId: true,
      title: true,
      description: true,
      location: true,
      startAt: true,
      endAt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      domain: { select: { id: true, name: true } },
      createdBy: { select: { person: { select: { fullName: true } } } },
      assignments: {
        where: { removedAt: null },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          completedAt: true,
          membership: {
            select: {
              id: true,
              person: { select: { fullName: true, rollNumberNormalized: true } },
            },
          },
        },
        orderBy: { assignedAt: "asc" },
      },
    },
  });
  if (!event) throw notFound("Event not found.");
  return event;
}

export async function createEvent(args: {
  input: CreateEventInput;
  actorAppUserId: string;
  requestId: string;
}): Promise<{ id: string }> {
  const { input, actorAppUserId, requestId } = args;
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw validationError({ endAt: "End time must be after start time." });
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        domainId: input.domainId,
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        startAt: input.startAt,
        endAt: input.endAt,
        status: "SCHEDULED",
        createdByAppUserId: actorAppUserId,
      },
      select: { id: true },
    });

    await writeAudit(tx, {
      actorAppUserId,
      action: "EVENT_CREATED",
      targetType: "Event",
      targetId: event.id,
      domainId: input.domainId,
      requestId,
      after: {
        title: input.title,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
      },
    });

    return event;
  });
}

export async function updateEvent(args: {
  domainId: string;
  eventId: string;
  actorAppUserId: string;
  requestId: string;
  data: {
    title?: string;
    description?: string | null;
    startAt?: Date;
    endAt?: Date;
    location?: string | null;
    status?: "SCHEDULED" | "CANCELLED" | "ARCHIVED";
  };
}): Promise<void> {
  const { domainId, eventId, actorAppUserId, requestId, data } = args;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: eventId, domainId } });
    if (!existing) throw notFound("Event not found.");

    const startAt = data.startAt ?? existing.startAt;
    const endAt = data.endAt ?? existing.endAt;
    if (endAt.getTime() <= startAt.getTime()) {
      throw validationError({ endAt: "End time must be after start time." });
    }

    const before = {
      title: existing.title,
      startAt: existing.startAt.toISOString(),
      endAt: existing.endAt.toISOString(),
      location: existing.location,
      status: existing.status,
    };

    await tx.event.update({
      where: { id: eventId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
        ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });

    const after = {
      title: data.title ?? existing.title,
      startAt: (data.startAt ?? existing.startAt).toISOString(),
      endAt: (data.endAt ?? existing.endAt).toISOString(),
      location: data.location !== undefined ? data.location : existing.location,
      status: data.status ?? existing.status,
    };

    await writeAudit(tx, {
      actorAppUserId,
      action:
        data.status === "CANCELLED"
          ? "EVENT_CANCELLED"
          : "EVENT_UPDATED",
      targetType: "Event",
      targetId: eventId,
      domainId,
      requestId,
      before,
      after,
    });
  });
}

/**
 * Ends an event (task) explicitly. Only a domain lead may do this, and only in
 * their own domain (enforced by the route guard). Reaching the deadline never
 * ends a task automatically.
 */
export async function completeEvent(args: {
  domainId: string;
  eventId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { domainId, eventId, actorAppUserId, requestId } = args;
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, domainId } });
    if (!event) throw notFound("Event not found.");
    if (event.status === "COMPLETED") return; // idempotent

    await tx.event.update({
      where: { id: eventId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    await writeAudit(tx, {
      actorAppUserId,
      action: "EVENT_COMPLETED",
      targetType: "Event",
      targetId: eventId,
      domainId,
      requestId,
      before: { status: event.status },
      after: { status: "COMPLETED" },
    });

    // Notify assigned volunteers (post-commit delivery via the outbox).
    const assigned = await tx.eventAssignment.findMany({
      where: { eventId, removedAt: null },
      select: { id: true, membership: { select: { person: { select: { fullName: true, emailNormalized: true } } } } },
    });
    for (const a of assigned) {
      await enqueueEmail(tx, {
        eventType: "EVENT_COMPLETED",
        templateKey: "EVENT_COMPLETED",
        recipient: a.membership.person.emailNormalized,
        payload: { fullName: a.membership.person.fullName, event: event.title },
        idempotencyKey: `event-completed:${eventId}:${a.id}`,
      });
    }
  });
}

/**
 * Re-opens an event that was ended by mistake: COMPLETED → SCHEDULED. Only a
 * domain lead, in their own domain.
 */
export async function reopenEvent(args: {
  domainId: string;
  eventId: string;
  actorAppUserId: string;
  requestId: string;
}): Promise<void> {
  const { domainId, eventId, actorAppUserId, requestId } = args;
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, domainId } });
    if (!event) throw notFound("Event not found.");
    if (event.status !== "COMPLETED") return;

    await tx.event.update({
      where: { id: eventId },
      data: { status: "SCHEDULED", endedAt: null },
    });

    await writeAudit(tx, {
      actorAppUserId,
      action: "EVENT_REOPENED",
      targetType: "Event",
      targetId: eventId,
      domainId,
      requestId,
      before: { status: "COMPLETED" },
      after: { status: "SCHEDULED" },
    });
  });
}
