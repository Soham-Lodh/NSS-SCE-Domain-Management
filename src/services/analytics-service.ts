import "server-only";

import { prisma } from "@/lib/db/prisma";

export type DomainAnalytics = {
  domainId: string;
  domainName: string;
  volunteers: number;
  activeVolunteers: number;
  events: number;
  upcomingEvents: number;
  ongoingEvents: number;
  pastEvents: number;
  cancelledEvents: number;
  assignments: number;
  completions: number;
};

/**
 * Aggregated overview for one domain. Uses bounded COUNT/groupBy queries — no
 * per-row work. Counts are always computed from DB facts, never client input.
 */
export async function domainAnalytics(domainId: string): Promise<DomainAnalytics> {
  const now = new Date();

  const [
    domain,
    volunteers,
    activeVolunteers,
    assignments,
    completions,
    upcoming,
    ongoing,
    past,
    cancelled,
  ] = await prisma.$transaction([
    prisma.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true } }),
    prisma.volunteerMembership.count({ where: { domainId } }),
    prisma.volunteerMembership.count({ where: { domainId, isActive: true } }),
    prisma.eventAssignment.count({ where: { event: { domainId }, removedAt: null } }),
    prisma.eventAssignment.count({
      where: { event: { domainId }, status: "COMPLETED", removedAt: null },
    }),
    prisma.event.count({ where: { domainId, status: { not: "CANCELLED" }, startAt: { gt: now } } }),
    prisma.event.count({
      where: { domainId, status: { not: "CANCELLED" }, startAt: { lte: now }, endAt: { gt: now } },
    }),
    prisma.event.count({ where: { domainId, status: { not: "CANCELLED" }, endAt: { lte: now } } }),
    prisma.event.count({ where: { domainId, status: "CANCELLED" } }),
  ]);

  const totalEvents = upcoming + ongoing + past + cancelled;

  return {
    domainId,
    domainName: domain?.name ?? "Domain",
    volunteers,
    activeVolunteers,
    events: totalEvents,
    upcomingEvents: upcoming,
    ongoingEvents: ongoing,
    pastEvents: past,
    cancelledEvents: cancelled,
    assignments,
    completions,
  };
}

/**
 * Cross-domain rollup for oversight roles. Bounded row count AND bounded
 * concurrency (batches of 5) so we never fan out hundreds of parallel queries
 * against the connection pool.
 */
export async function allDomainsAnalytics(): Promise<DomainAnalytics[]> {
  const domains = await prisma.domain.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  const results: DomainAnalytics[] = [];
  const BATCH = 5;
  for (let i = 0; i < domains.length; i += BATCH) {
    const slice = domains.slice(i, i + BATCH);
    const batch = await Promise.all(slice.map((d) => domainAnalytics(d.id)));
    results.push(...batch);
  }
  return results;
}
