import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertRole } from "@/lib/authorization/require";
import { paginationQuery } from "@/lib/validation/schemas";
import { listEmailDeliveryLogs, type EmailDeliveryStatusFilter } from "@/services/email-log-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const query = paginationQuery.merge(
  z.object({
    recipient: z.string().max(200).optional(),
    templateKey: z.string().max(60).optional(),
    status: z.enum(["QUEUED", "SENT", "FAILED", "DEAD", "SUPPRESSED"]).optional(),
    domainId: z.string().uuid().optional(),
    eventId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
);

/**
 * Email delivery logs. TECH_TEAM and COORDINATOR only — enforced server-side,
 * domain leads and volunteers are denied even with a manually typed URL.
 */
export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertRole(ctx, ["TECH_TEAM", "COORDINATOR"]);
  const filters = parseQuery(req, query);

  const result = await listEmailDeliveryLogs({
    filters: {
      recipient: filters.recipient,
      templateKey: filters.templateKey,
      status: filters.status as EmailDeliveryStatusFilter | undefined,
      domainId: filters.domainId,
      eventId: filters.eventId,
      from: filters.from,
      to: filters.to,
    },
    page: filters.page,
    limit: filters.limit,
  });
  return apiOk(result, requestId);
});
