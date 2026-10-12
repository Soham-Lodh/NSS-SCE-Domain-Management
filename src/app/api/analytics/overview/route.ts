import { apiOk } from "@/lib/api/response";
import { parseQuery, protectedRoute } from "@/lib/api/route";
import { requireAuthContext, resolveDomainScope, assertViewAllDomains } from "@/lib/authorization/require";
import { allDomainsAnalytics, domainAnalytics } from "@/services/analytics-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const query = z.object({
  domainId: z.string().uuid().optional(),
  scope: z.enum(["domain", "all"]).default("domain"),
});

export const GET = protectedRoute(async (req, requestId) => {
  const ctx = await requireAuthContext({ requestId, provision: true });
  const { domainId, scope } = parseQuery(req, query);

  if (scope === "all") {
    assertViewAllDomains(ctx);
    const all = await allDomainsAnalytics();
    return apiOk({ domains: all }, requestId);
  }

  const scoped = resolveDomainScope(ctx, domainId);
  const analytics = await domainAnalytics(scoped);
  return apiOk({ domains: [analytics] }, requestId);
});
