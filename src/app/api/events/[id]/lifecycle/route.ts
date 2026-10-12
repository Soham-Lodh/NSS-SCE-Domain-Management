import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import {
  requireAuthContext,
  assertCanOperateEvents,
  resolveDomainScope,
  assertSameOrigin,
} from "@/lib/authorization/require";
import { completeEvent, reopenEvent } from "@/services/event-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ action: z.enum(["complete", "reopen"]) });

/**
 * Explicitly ends an event ("complete") or re-opens one ended by mistake
 * ("reopen"). Only a domain lead, in their own domain. Reaching the deadline
 * never ends an event.
 */
export const POST = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const eventId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  assertCanOperateEvents(auth, domainId);
  const { action } = await parseBody(req, bodySchema);

  const base = { domainId, eventId, actorAppUserId: auth.appUserId, requestId };
  if (action === "complete") await completeEvent(base);
  else await reopenEvent(base);

  return apiOk({ ok: true }, requestId);
});
