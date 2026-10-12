import { apiOk } from "@/lib/api/response";
import { protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, resolveDomainScope } from "@/lib/authorization/require";
import { getVolunteerDetail } from "@/services/volunteer-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = protectedRoute<Ctx>(async (_req, requestId, ctx) => {
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  const detail = await getVolunteerDetail(domainId, membershipId);
  // Return only the history-relevant slice.
  return apiOk({ assignments: detail.assignments, member: detail.person }, requestId);
});
