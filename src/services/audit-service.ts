import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Paginated } from "@/lib/utils/pagination";

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string | null;
  targetId: string | null;
  domainId: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  requestId: string | null;
  actor: { id: string; fullName: string; role: string } | null;
};

/**
 * Bounded, filterable audit listing. Requires bounded date ranges for wide
 * scans; always paginated. Audit access is restricted by the route layer.
 */
export async function listAuditLogs(args: {
  filters: {
    domainId?: string;
    actorAppUserId?: string;
    action?: string;
    outcome?: "SUCCESS" | "DENIED" | "FAILURE";
    from?: Date;
    to?: Date;
  };
  page: number;
  limit: number;
  /** Domain leads are denied here; oversight roles pass their scope. */
  restrictToDomainId?: string | null;
}): Promise<Paginated<AuditRow>> {
  const { filters, page, limit, restrictToDomainId } = args;
  const where: Prisma.AuditLogWhereInput = {
    ...(restrictToDomainId !== undefined && restrictToDomainId !== null
      ? { domainId: restrictToDomainId }
      : filters.domainId
        ? { domainId: filters.domainId }
        : {}),
    ...(filters.actorAppUserId ? { actorAppUserId: filters.actorAppUserId } : {}),
    ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        action: true,
        targetType: true,
        targetId: true,
        domainId: true,
        outcome: true,
        requestId: true,
        actor: {
          select: {
            id: true,
            person: { select: { fullName: true } },
            roleGrants: { where: { isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const items: AuditRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    domainId: r.domainId,
    outcome: r.outcome,
    requestId: r.requestId,
    actor: r.actor
      ? {
          id: r.actor.id,
          fullName: r.actor.person.fullName,
          role: r.actor.roleGrants[0]?.role ?? "VOLUNTEER",
        }
      : null,
  }));

  return { items, page, limit, total, hasMore: page * limit < total };
}
