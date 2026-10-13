import "server-only";

import { prisma } from "@/lib/db/prisma";
import { memoized, invalidateMemo, clearMemo } from "@/lib/cache/memory";
import { canViewAllDomains } from "@/lib/authorization/roles";
import type { AuthContext } from "@/lib/auth/types";
import { forbidden } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/write-audit";

export type DomainDTO = { id: string; name: string; description: string | null };

/**
 * Active domain reference data. Small, non-sensitive, rarely changing → the
 * only place we use the process-local TTL memo (5 min). Always falls back to
 * the database; explicitly invalidated on domain mutations.
 */
export async function listActiveDomains(): Promise<DomainDTO[]> {
  return memoized("domains:active", 5 * 60_000, async () => {
    const rows = await prisma.domain.findMany({
      where: { isActive: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
    return rows;
  });
}

/**
 * Domains the caller may see. A domain lead sees only their own domain;
 * oversight roles see all; everyone else is denied.
 */
export async function listVisibleDomains(ctx: AuthContext): Promise<DomainDTO[]> {
  if (canViewAllDomains(ctx.roles)) return listActiveDomains();
  if (ctx.domainIds.length > 0) {
    return prisma.domain.findMany({
      where: { id: { in: ctx.domainIds }, isActive: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
  }
  throw forbidden();
}

/**
 * Creates a domain. Domains are the anchor for volunteer import (an import row
 * with an unknown domain is rejected), so oversight roles can add them here.
 * Name is unique — a duplicate returns the existing domain id.
 */
export async function createDomain(args: {
  actor: AuthContext;
  name: string;
  description?: string | null;
  requestId: string;
}): Promise<{ id: string; created: boolean }> {
  const { actor, name, description, requestId } = args;
  const trimmed = name.trim();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.domain.findUnique({ where: { name: trimmed } });
    if (existing) return { id: existing.id, created: false };

    const domain = await tx.domain.create({
      data: { name: trimmed, description: description?.trim() || null },
    });
    await writeAudit(tx, {
      actorAppUserId: actor.appUserId,
      action: "DOMAIN_CREATED",
      targetType: "Domain",
      targetId: domain.id,
      domainId: domain.id,
      requestId,
      after: { name: domain.name },
    });
    invalidateDomainCache();
    return { id: domain.id, created: true };
  });
}

/** Call after a domain create/update/deactivate. */
export function invalidateDomainCache(): void {
  invalidateMemo("domains:");
}

/** Test/ops helper. */
export function clearDomainCache(): void {
  clearMemo();
}
