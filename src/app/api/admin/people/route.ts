import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, assertSameOrigin } from "@/lib/authorization/require";
import { personUpsertSchema } from "@/lib/validation/schemas";
import { addPerson, listPendingPeople } from "@/services/people-service";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async (_req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(ctx);
  const pending = await listPendingPeople();
  return apiOk({ pending }, requestId);
});

export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(ctx);
  const input = await parseBody(req, personUpsertSchema);
  const result = await addPerson({
    actor: ctx,
    fullName: input.fullName,
    email: input.email,
    role: input.role,
    domainId: input.domainId ?? null,
    projectId: input.projectId ?? null,
    requestId,
  });
  return apiOk(result, requestId);
});
