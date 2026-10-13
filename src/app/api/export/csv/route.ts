import { NextResponse } from "next/server";
import { z } from "zod";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, resolveDomainScope } from "@/lib/authorization/require";
import {
  buildAssignmentsCsv,
  buildDomainReportCsv,
  buildMembersCsv,
} from "@/services/export-service";
import { toCsv } from "@/lib/utils/csv";

export const dynamic = "force-dynamic";

const query = z.object({
  domainId: z.string().uuid().optional(),
  dataset: z.enum(["members", "assignments", "domain-events"]),
});

/**
 * CSV export (the clipboard copy flow pastes this same serialized table into
 * Google Sheets). Same server-side scope rules as the Excel exports, same
 * data definitions, one consistent table per dataset. Returns text/csv with
 * private/no-store headers — never cached or shared across users.
 */
export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const { domainId, dataset } = parseQuery(req, query);
  const scoped = resolveDomainScope(ctx, domainId);

  const data =
    dataset === "members"
      ? await buildMembersCsv(scoped)
      : dataset === "assignments"
        ? await buildAssignmentsCsv(scoped)
        : await buildDomainReportCsv(scoped);

  const csv = toCsv(data.headers, data.rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(data.filename)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "x-request-id": requestId,
    },
  });
});
