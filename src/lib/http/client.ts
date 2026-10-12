"use client";

import type { ApiErrorCode } from "@/lib/api/response";

export class ApiClientError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Single client-side fetch wrapper: attaches a correlation id, sends cookies
 * same-origin (never tokens in local storage), and maps the API error envelope.
 */
export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-request-id", crypto.randomUUID());
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
    // Personalized data must never be cached by the browser HTTP cache.
    cache: "no-store",
  });

  if (!res.ok) {
    let code: ApiErrorCode = "INTERNAL";
    let message = `Request failed (${res.status})`;
    let details: unknown;
    let requestId: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details;
        requestId = body.error.requestId;
      }
    } catch {
      // non-JSON error body
    }
    throw new ApiClientError(code, message, res.status, details, requestId);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
