import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, resolveDomainScope } from "@/lib/authorization/require";
import { canViewAllDomains } from "@/lib/authorization/roles";
import { getVolunteerDetail, getVolunteerMembershipDomainId } from "@/services/volunteer-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const query = z.object({ domainId: z.string().uuid().optional() });

export const GET = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const { domainId: requestedDomainId } = parseQuery(req, query);
  const domainId =
    canViewAllDomains(auth.roles) && !requestedDomainId
      ? await getVolunteerMembershipDomainId(membershipId)
      : resolveDomainScope(auth, requestedDomainId);
  const detail = await getVolunteerDetail(domainId, membershipId);
  // Return only the history-relevant slice.
  return apiOk({ assignments: detail.assignments, member: detail.person }, requestId);
});
