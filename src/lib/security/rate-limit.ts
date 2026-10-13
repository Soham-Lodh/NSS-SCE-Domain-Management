import "server-only";

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;
const READ_LIMIT = 120;
const WRITE_LIMIT = 30;

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Process-local API guard. It protects a single server instance immediately;
 * deployments with multiple instances should enforce the same limits at the
 * edge as well. Query parameters are intentionally excluded from the key.
 */
export function takeRateLimit(req: Request): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
} {
  const limit = req.method === "GET" || req.method === "HEAD" ? READ_LIMIT : WRITE_LIMIT;
  const now = Date.now();
  const pathname = new URL(req.url).pathname;
  const key = `${clientKey(req)}:${req.method}:${pathname}`;
  const current = windows.get(key);
  const window = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : current;

  window.count += 1;
  windows.set(key, window);

  // Keep idle keys bounded in long-lived processes without a timer per key.
  if (windows.size > 10_000) {
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

export function addRateLimitHeaders(
  response: Response,
  state: ReturnType<typeof takeRateLimit>,
): void {
  response.headers.set("RateLimit-Limit", String(state.limit));
  response.headers.set("RateLimit-Remaining", String(state.remaining));
  response.headers.set("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));
  if (!state.allowed) {
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000))));
  }
}
