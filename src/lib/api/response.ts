import { NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";

/** Stable API error codes. Clients branch on these, never on messages. */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; requestId: string; details?: unknown };
};

export function requestIdOf(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, requestId, ...(details ? { details } : {}) } },
    { status: STATUS[code] },
  );
}

export function apiOk<T>(data: T, requestId: string): NextResponse<T> {
  const res = NextResponse.json(data);
  res.headers.set("x-request-id", requestId);
  // Personalized data is never publicly cacheable.
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}

/**
 * Wraps a route handler: adds a request id, converts thrown Controls into
 * responses and never leaks stack traces to clients.
 */
export function withApi<T extends unknown[]>(
  handler: (req: Request, requestId: string, ...rest: T) => Promise<NextResponse>,
) {
  return async (req: Request, ...rest: T): Promise<NextResponse> => {
    const requestId = requestIdOf(req);
    try {
      return await handler(req, requestId, ...rest);
    } catch (err) {
      if (err instanceof ApiControl) {
        return apiError(err.code, err.message, requestId, err.details);
      }
      logger.error("unhandled_api_error", {
        requestId,
        message: err instanceof Error ? err.message : "unknown",
      });
      return apiError("INTERNAL", "Something went wrong.", requestId);
    }
  };
}

/** Throwable control-flow error for route/service code. */
export class ApiControl extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiControl";
  }
}

export const unauthenticated = (m = "Authentication required.") =>
  new ApiControl("UNAUTHENTICATED", m);
export const forbidden = (m = "You do not have permission to do that.") =>
  new ApiControl("FORBIDDEN", m);
export const notFound = (m = "Resource not found.") => new ApiControl("NOT_FOUND", m);
export const validationError = (details: unknown, m = "Invalid request.") =>
  new ApiControl("VALIDATION_ERROR", m, details);
