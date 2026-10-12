import { apiOk } from "@/lib/api/response";
import { protectedRoute } from "@/lib/api/route";
import { requireAuthContext } from "@/lib/authorization/require";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async (_req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  return apiOk(
    {
      appUserId: ctx.appUserId,
      fullName: ctx.fullName,
      email: ctx.email,
      role: ctx.role,
      roles: ctx.roles,
      domainId: ctx.domainId,
      isActive: ctx.isActive,
    },
    requestId,
  );
});
