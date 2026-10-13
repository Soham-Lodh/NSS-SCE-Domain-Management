import { NextResponse } from "next/server";
import { apiError, requestIdOf, type ApiErrorBody } from "@/lib/api/response";

type Window = { count: number; resetAt: number };
export type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

const WINDOW_MS = 60_000;
/** All API requests from one client, across every path. */
const GLOBAL_LIMIT = 600;
/** Per route+method from one client. */
const READ_LIMIT = 120;
const WRITE_LIMIT = 30;
/** Bound the key map so an idle process never grows without limit. */
const MAX_KEYS = 10_000;

const windows = new Map<string, Window>();

// Deliberately no "server-only" marker: this module is shared by the edge
// middleware (pre-auth global bucket) and the Node route handlers (per-route
// buckets). It holds no secrets and reads nothing from the environment.

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

function consume(key: string, limit: number, now: number): RateLimitState {
  const current = windows.get(key);
  const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;

  window.count += 1;
  windows.set(key, window);

  // Sweep expired keys only when the map is actually large, without a timer.
  if (windows.size > MAX_KEYS) {
    for (const [candidate, value] of windows) {
      if (value.resetAt <= now) windows.delete(candidate);
    }
  }

  return {
    allowed: window.count <= limit,
    limit,
    remaining: Math.max(0, limit - window.count),
    resetAt: window.resetAt,
  };
}

/**
 * Fixed-window client rate limiter.
 *
 * - `bucket: "global"` — one budget per client across the whole API; checked
 *   in the middleware before any session or database work, so anonymous floods
 *   are rejected cheaply.
 * - `bucket: "route"` — a budget per client + method + path; checked inside the
 *   route wrapper so one busy endpoint cannot exhaust a client's whole budget.
 *
 * Process-local (per instance / per edge isolate): deployments with several
 * instances should additionally enforce an equivalent limit at the CDN/edge.
 * Query parameters are intentionally excluded from the key.
 */
export function takeRateLimit(req: Request, bucket: "global" | "route" = "route"): RateLimitState {
  const now = Date.now();
  const client = clientKey(req);
  if (bucket === "global") return consume(`${client}:*:*`, GLOBAL_LIMIT, now);

  const limit = req.method === "GET" || req.method === "HEAD" ? READ_LIMIT : WRITE_LIMIT;
  const pathname = new URL(req.url).pathname;
  return consume(`${client}:${req.method}:${pathname}`, limit, now);
}

export function addRateLimitHeaders(response: Response, state: RateLimitState): void {
  response.headers.set("RateLimit-Limit", String(state.limit));
  response.headers.set("RateLimit-Remaining", String(state.remaining));
  response.headers.set("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
  if (!state.allowed) {
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000))),
    );
  }
}

/** Standard `RATE_LIMITED` envelope with `Retry-After` + RateLimit headers. */
export function rateLimitResponse(req: Request, state: RateLimitState): NextResponse<ApiErrorBody> {
  const response = apiError(
    "RATE_LIMITED",
    "Too many requests. Please try again shortly.",
    requestIdOf(req),
  );
  addRateLimitHeaders(response, state);
  return response;
}
