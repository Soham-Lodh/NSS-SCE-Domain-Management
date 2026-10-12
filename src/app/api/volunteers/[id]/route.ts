import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, resolveDomainScope, assertSameOrigin } from "@/lib/authorization/require";
import { updateVolunteerSchema } from "@/lib/validation/schemas";
import { getVolunteerDetail, updateVolunteer } from "@/services/volunteer-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = protectedRoute<Ctx>(async (_req, requestId, ctx) => {
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  const detail = await getVolunteerDetail(domainId, membershipId);
  return apiOk(detail, requestId);
});

export const PATCH = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(auth);
  const { id } = await ctx.params;
  const membershipId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  const data = await parseBody(req, updateVolunteerSchema);
  await updateVolunteer({ domainId, membershipId, actorAppUserId: auth.appUserId, requestId, data });
  return apiOk({ ok: true }, requestId);
});
