import { apiOk } from "@/lib/api/response";
import { protectedRoute } from "@/lib/api/route";
import { requireAuthContext } from "@/lib/authorization/require";
import { listActiveProjects } from "@/services/project-service";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async (_req, requestId) => {
  await requireAuthContext({ requestId, provision: true });
  const projects = await listActiveProjects();
  return apiOk({ projects }, requestId);
});
