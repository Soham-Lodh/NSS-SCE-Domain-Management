import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import {
  requireAuthContext,
  assertCanOperateEvents,
  resolveDomainScope,
  assertSameOrigin,
} from "@/lib/authorization/require";
import { assignmentActionSchema } from "@/lib/validation/schemas";
import {
  completeAssignment,
  reassignAssignment,
  removeAssignment,
  reopenAssignment,
} from "@/services/assignment-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const assignmentId = requireUuidParam(id);
  const domainId = resolveDomainScope(auth);
  assertCanOperateEvents(auth, domainId);

  const body = await parseBody(req, assignmentActionSchema);
  const base = { assignmentId, domainId, actorAppUserId: auth.appUserId, requestId };

  switch (body.action) {
    case "complete":
      await completeAssignment(base);
      break;
    case "reopen":
      await reopenAssignment(base);
      break;
    case "remove":
      await removeAssignment(base);
      break;
    case "reassign":
      await reassignAssignment({ ...base, targetEventId: body.targetEventId });
      break;
  }
  return apiOk({ ok: true }, requestId);
});
