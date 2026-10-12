import { NextResponse } from "next/server";
import { z } from "zod";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, resolveDomainScope } from "@/lib/authorization/require";
import { buildDomainReport } from "@/services/export-service";

export const dynamic = "force-dynamic";

const query = z.object({ domainId: z.string().uuid().optional() });

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const { domainId } = parseQuery(req, query);
  const scoped = resolveDomainScope(ctx, domainId);
  const file = await buildDomainReport(scoped);

  return new NextResponse(file.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "x-request-id": requestId,
    },
  });
});
