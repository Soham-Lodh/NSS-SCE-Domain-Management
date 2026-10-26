import { apiOk } from "@/lib/api/response";
import { parseBody, parseQuery, protectedRoute } from "@/lib/api/route";
import {
  requireAuthContext,
  assertCanOperateEvents,
  resolveEventDomainScope,
  assertSameOrigin,
} from "@/lib/authorization/require";
import { createEventSchema, eventListQuery, paginationQuery } from "@/lib/validation/schemas";
import { createEvent, listEvents } from "@/services/event-service";

export const dynamic = "force-dynamic";

const listSchema = eventListQuery.merge(paginationQuery);

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const filters = parseQuery(req, listSchema);
  const domainId = resolveEventDomainScope(ctx, filters.domainId);
  const result = await listEvents({
    domainId,
    category: filters.category,
    search: filters.search,
    page: filters.page,
    limit: filters.limit,
  });
  return apiOk(result, requestId);
});

export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  const input = await parseBody(req, createEventSchema);
  // Only a domain lead, inside their own domain.
  assertCanOperateEvents(ctx, input.domainId);
  const result = await createEvent({ input, actorAppUserId: ctx.appUserId, requestId });
  return apiOk(result, requestId);
});
