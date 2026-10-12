import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import {
  requireAuthContext,
  assertCanOperateEvents,
  resolveDomainScope,
  assertSameOrigin,
} from "@/lib/authorization/require";
import { updateEventSchema } from "@/lib/validation/schemas";
import { getEventDetail, updateEvent } from "@/services/event-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = protectedRoute<Ctx>(async (_req, requestId, ctx) => {
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const eventId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  const detail = await getEventDetail(domainId, eventId);
  return apiOk(detail, requestId);
});

export const PATCH = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const eventId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  // Only a domain lead may mutate events, and only in their own domain.
  assertCanOperateEvents(auth, domainId);
  const data = await parseBody(req, updateEventSchema);
  await updateEvent({ domainId, eventId, actorAppUserId: auth.appUserId, requestId, data });
  return apiOk({ ok: true }, requestId);
});
