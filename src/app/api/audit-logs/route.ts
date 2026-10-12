import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertViewAuditLogs } from "@/lib/authorization/require";
import { auditListQuery, paginationQuery } from "@/lib/validation/schemas";
import { listAuditLogs } from "@/services/audit-service";
import { canViewAllDomains } from "@/lib/authorization/roles";

export const dynamic = "force-dynamic";

const query = auditListQuery.merge(paginationQuery);

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertViewAuditLogs(ctx);
  const filters = parseQuery(req, query);

  // Oversight roles see all; a domain lead is denied by assertViewAuditLogs.
  const restrictToDomainId = canViewAllDomains(ctx.roles)
    ? filters.domainId ?? null
    : ctx.domainId;

  const result = await listAuditLogs({
    filters: {
      domainId: filters.domainId,
      actorAppUserId: filters.actorAppUserId,
      action: filters.action,
      outcome: filters.outcome,
      from: filters.from,
      to: filters.to,
    },
    page: filters.page,
    limit: filters.limit,
    restrictToDomainId,
  });
  return apiOk(result, requestId);
});
