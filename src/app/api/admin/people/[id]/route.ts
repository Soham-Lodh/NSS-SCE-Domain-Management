import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute, requireUuidParam } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, assertSameOrigin } from "@/lib/authorization/require";
import { removePerson } from "@/services/people-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const query = z.object({ kind: z.enum(["user", "pending"]).default("user") });

export const DELETE = protectedRoute<Ctx>(async (req, requestId, ctx) => {
  assertSameOrigin(req);
  const auth = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(auth);
  const { id } = await ctx.params;
  const targetId = requireUuidParam(id);
  const { kind } = parseQuery(req, query);
  await removePerson({ actor: auth, kind, id: targetId, requestId });
  return apiOk({ ok: true }, requestId);
});
