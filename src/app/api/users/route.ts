import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster } from "@/lib/authorization/require";
import { paginationQuery } from "@/lib/validation/schemas";
import { listUsers } from "@/services/user-admin-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const userQuery = paginationQuery.merge(
  z.object({ search: z.string().trim().max(200).optional() }),
);

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  // Only tech team / coordinator may browse the user directory.
  assertManageVolunteerMaster(ctx);
  const filters = parseQuery(req, userQuery);
  const result = await listUsers({ search: filters.search, page: filters.page, limit: filters.limit });
  return apiOk(result, requestId);
});
