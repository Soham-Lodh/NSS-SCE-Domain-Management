import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Paginated } from "@/lib/utils/pagination";

export type EmailDeliveryStatusFilter = "QUEUED" | "SENT" | "FAILED" | "DEAD" | "SUPPRESSED";

export type EmailDeliveryLogRow = {
  id: string;
  outboxId: string | null;
  recipient: string;
  templateKey: string;
  eventType: string;
  subject: string | null;
  status: EmailDeliveryStatusFilter;
  attemptNumber: number;
  eventId: string | null;
  eventTitle: string | null;
  domainId: string | null;
  domainName: string | null;
  assignmentId: string | null;
  monthKey: string | null;
  providerMessageId: string | null;
  reason: string | null;
  createdAt: Date;
};

/**
 * Bounded, filterable email-delivery log listing. TECH_TEAM / COORDINATOR
 * only — enforced by the route; never exposed to domain leads or volunteers.
 */
export async function listEmailDeliveryLogs(args: {
  filters: {
    recipient?: string;
    templateKey?: string;
    status?: EmailDeliveryStatusFilter;
    domainId?: string;
    eventId?: string;
    from?: Date;
    to?: Date;
  };
  page: number;
  limit: number;
}): Promise<Paginated<EmailDeliveryLogRow>> {
  const { filters, page, limit } = args;
  const where: Prisma.EmailDeliveryLogWhereInput = {
    ...(filters.recipient ? { recipient: { contains: filters.recipient, mode: "insensitive" } } : {}),
    ...(filters.templateKey
      ? { templateKey: { equals: filters.templateKey, mode: "insensitive" } }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.domainId ? { domainId: filters.domainId } : {}),
    ...(filters.eventId ? { eventId: filters.eventId } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.emailDeliveryLog.count({ where }),
    prisma.emailDeliveryLog.findMany({
      where,
      select: {
        id: true,
        outboxId: true,
        recipient: true,
        templateKey: true,
        eventType: true,
        subject: true,
        status: true,
        attemptNumber: true,
        eventId: true,
        domainId: true,
        assignmentId: true,
        monthKey: true,
        providerMessageId: true,
        reason: true,
        createdAt: true,
        event: { select: { title: true } },
        domain: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const items: EmailDeliveryLogRow[] = rows.map((r) => ({
    id: r.id,
    outboxId: r.outboxId,
    recipient: r.recipient,
    templateKey: r.templateKey,
    eventType: r.eventType,
    subject: r.subject,
    status: r.status,
    attemptNumber: r.attemptNumber,
    eventId: r.eventId,
    eventTitle: r.event?.title ?? null,
    domainId: r.domainId,
    domainName: r.domain?.name ?? null,
    assignmentId: r.assignmentId,
    monthKey: r.monthKey,
    providerMessageId: r.providerMessageId,
    reason: r.reason,
    createdAt: r.createdAt,
  }));

  return { items, page, limit, total, hasMore: page * limit < total };
}
