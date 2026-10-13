import { apiOk } from "@/lib/api/response";
import { parseBody, parseQuery, protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, resolveDomainScope, assertSameOrigin } from "@/lib/authorization/require";
import { canViewAllDomains } from "@/lib/authorization/roles";
import { updateVolunteerSchema } from "@/lib/validation/schemas";
import { getVolunteerDetail, getVolunteerMembershipDomainId, updateVolunteer } from "@/services/volunteer-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const query = z.object({ domainId: z.string().uuid().optional() });

async function resolveVolunteerDomain(auth: Awaited<ReturnType<typeof requireAuthContext>>, membershipId: string, requestedDomainId?: string) {
  const actualDomainId = await getVolunteerMembershipDomainId(membershipId);
  if (!requestedDomainId || requestedDomainId === actualDomainId) {
    if (canViewAllDomains(auth.roles)) return actualDomainId;
    return resolveDomainScope(auth, actualDomainId);
  }
  return resolveDomainScope(auth, requestedDomainId);
}

export const GET = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const { domainId: requestedDomainId } = parseQuery(req, query);
  const domainId = await resolveVolunteerDomain(auth, membershipId, requestedDomainId);
  const detail = await getVolunteerDetail(domainId, membershipId);
  return apiOk(detail, requestId);
});

export const PATCH = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(auth);
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const { domainId: requestedDomainId } = parseQuery(req, query);
  const domainId = await resolveVolunteerDomain(auth, membershipId, requestedDomainId);
  const data = await parseBody(req, updateVolunteerSchema);
  await updateVolunteer({ domainId, membershipId, actorAppUserId: auth.appUserId, requestId, data });
  return apiOk({ ok: true }, requestId);
});
