import "server-only";

import type { Prisma, AuditOutcome } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";

/**
 * Business audit trail. Append-only through the application. Sensitive
 * mutations write their audit row INSIDE the same Prisma transaction so the
 * business change and the audit entry commit together.
 *
 * Diffs are allowlisted and must never contain secrets, tokens or cookies.
 */
export type AuditEntry = {
  actorAppUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  domainId?: string | null;
  outcome?: AuditOutcome;
  requestId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

type Tx = Prisma.TransactionClient;

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorAppUserId: entry.actorAppUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      domainId: entry.domainId ?? null,
      outcome: entry.outcome ?? "SUCCESS",
      requestId: entry.requestId ?? null,
      beforeJson: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Records authorization denials where observable, WITHOUT revealing whether a
 * cross-domain resource exists. Best-effort: never throws into the caller.
 */
export async function recordDenial(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorAppUserId: entry.actorAppUserId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        domainId: entry.domainId ?? null,
        outcome: "DENIED",
        requestId: entry.requestId ?? null,
      },
    });
  } catch (err) {
    logger.warn("audit_denial_write_failed", {
      action: entry.action,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
