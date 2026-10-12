import { apiOk } from "@/lib/api/response";
import { parseBody, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, assertSameOrigin } from "@/lib/authorization/require";
import { importCommitSchema } from "@/lib/validation/schemas";
import { commitImport } from "@/services/import-service";

export const dynamic = "force-dynamic";

/**
 * Step 2 of import: the client sends back the rows it wants to add. The server
 * re-validates EVERY row from scratch (allowed email domain, existing
 * domain/project, duplicates) and inserts only valid ones — never trusting the
 * preview status sent by the browser.
 */
export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(ctx);

  const { rows } = await parseBody(req, importCommitSchema);
  const result = await commitImport({ rows, actorAppUserId: ctx.appUserId, requestId });
  return apiOk(result, requestId);
});
