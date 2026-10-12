import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertViewAllDomains, assertSameOrigin } from "@/lib/authorization/require";
import { createDomain, listVisibleDomains } from "@/services/domain-service";
import { domainCreateSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async (_req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const domains = await listVisibleDomains(ctx);
  return apiOk({ domains }, requestId);
});

export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertViewAllDomains(ctx);
  const input = await parseBody(req, domainCreateSchema);
  const result = await createDomain({
    actor: ctx,
    name: input.name,
    description: input.description ?? null,
    requestId,
  });
  return apiOk(result, requestId);
});
