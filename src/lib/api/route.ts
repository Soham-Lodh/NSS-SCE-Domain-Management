import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ApiControl, apiError, requestIdOf, validationError } from "@/lib/api/response";
import { recordDenial } from "@/lib/audit/write-audit";
import { getAuthContext } from "@/lib/auth/session";
import { logger } from "@/lib/observability/logger";
import { addRateLimitHeaders, takeRateLimit } from "@/lib/security/rate-limit";

/**
 * Server-only route wrapper: injects a correlation id, maps thrown ApiControl
 * errors to the standard envelope, records authorization denials (without
 * leaking cross-domain existence) and never returns stack traces.
 */
export function protectedRoute<Ctx = unknown>(
  handler: (req: Request, requestId: string, ctx: Ctx) => Promise<NextResponse>,
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    const requestId = requestIdOf(req);
    const rate = takeRateLimit(req);
    if (!rate.allowed) {
      const response = apiError("RATE_LIMITED", "Too many requests. Please try again shortly.", requestId);
      addRateLimitHeaders(response, rate);
      return response;
    }
    try {
      const response = await handler(req, requestId, ctx);
      addRateLimitHeaders(response, rate);
      return response;
    } catch (err) {
      if (err instanceof ApiControl) {
        if (err.code === "FORBIDDEN") {
          const actor = await getAuthContext({ requestId, provision: false }).catch(() => null);
          await recordDenial({
            actorAppUserId: actor?.appUserId ?? null,
            action: "AUTHORIZATION_DENIED",
            requestId,
            outcome: "DENIED",
          });
        }
        const response = apiError(err.code, err.message, requestId, err.details);
        addRateLimitHeaders(response, rate);
        return response;
      }
      logger.error("unhandled_route_error", {
        requestId,
        message: err instanceof Error ? err.message : "unknown",
      });
      const response = apiError("INTERNAL", "Something went wrong.", requestId);
      addRateLimitHeaders(response, rate);
      return response;
    }
  };
}

function formatZod(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    out[issue.path.join(".") || "_"] = issue.message;
  }
  return out;
}

export async function parseBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw validationError({ _: "Expected a JSON body." });
  }
  const result = schema.safeParse(json);
  if (!result.success) throw validationError(formatZod(result.error));
  return result.data;
}

export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value !== "") raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(formatZod(result.error));
  return result.data;
}

/** Path params are strings; validate them as UUIDs before use. */
export function requireUuidParam(value: string | undefined, name = "id"): string {
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "");
  if (!ok) throw validationError({ [name]: "Invalid id." });
  return value as string;
}
