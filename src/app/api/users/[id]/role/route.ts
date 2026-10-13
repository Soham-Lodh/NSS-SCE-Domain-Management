import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, assertSameOrigin } from "@/lib/authorization/require";
import { roleChangeSchema } from "@/lib/validation/schemas";
import { changeUserRole } from "@/services/user-admin-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  const { id } = await ctx.params;
  const targetAppUserId = requireUuidParam(id, "userId");
  const body = await parseBody(req, roleChangeSchema);

  // All hierarchy / last-coordinator / self checks live in the service.
  await changeUserRole({
    actor: auth,
    targetAppUserId,
    role: body.role,
    domainId: body.domainId ?? null,
    projectId: body.projectId ?? null,
    requestId,
  });
  return apiOk({ ok: true }, requestId);
});
