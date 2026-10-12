import { apiOk } from "@/lib/api/response";
import { parseBody, parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, resolveDomainScope, assertSameOrigin } from "@/lib/authorization/require";
import { createVolunteerSchema, volunteerListQuery, paginationQuery } from "@/lib/validation/schemas";
import { createVolunteer, listVolunteers } from "@/services/volunteer-service";

export const dynamic = "force-dynamic";

const listSchema = volunteerListQuery.merge(paginationQuery);

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const filters = parseQuery(req, listSchema);
  const domainId = resolveDomainScope(ctx, filters.domainId);

  const result = await listVolunteers({
    domainId,
    search: filters.search,
    projectId: filters.projectId,
    activeOnly: filters.activeOnly,
    page: filters.page,
    limit: filters.limit,
  });
  return apiOk(result, requestId);
});

export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(ctx);
  const input = await parseBody(req, createVolunteerSchema);
  const result = await createVolunteer({ input, actorAppUserId: ctx.appUserId, requestId });
  return apiOk(result, requestId);
});
