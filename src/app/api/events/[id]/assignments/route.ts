import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import {
  requireAuthContext,
  assertCanOperateEvents,
  assertSameOrigin,
} from "@/lib/authorization/require";
import { bulkAssignSchema } from "@/lib/validation/schemas";
import { bulkAssign } from "@/services/assignment-service";
import { getEventDomainId } from "@/services/event-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const eventId = requireUuidParam(id);
  const domainId = await getEventDomainId(eventId);
  assertCanOperateEvents(auth, domainId);
  const { membershipIds } = await parseBody(req, bulkAssignSchema);

  const summary = await bulkAssign({
    eventId,
    domainId,
    membershipIds,
    actorAppUserId: auth.appUserId,
    requestId,
  });
  return apiOk(summary, requestId);
});
