"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/http/client";
import { FeedbackProvider } from "@/components/providers/feedback-provider";

/**
 * User-side cache configuration.
 *
 * - staleTime: results are reused without a network call inside the window.
 * - gcTime: inactive queries are garbage-collected (no dead cache growth).
 * - We do NOT retry auth/permission errors, and we don't refetch aggressively
 *   on focus/reconnect, to avoid redundant backend calls.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            gcTime: 5 * 60_000,
            // Refetch only after a query has become stale, keeping returning
            // users current without repeatedly reading fresh data.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiClientError) {
                // Never hammer auth, permission, validation or rate-limit
                // failures — retrying only widens the failure.
                if (["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "RATE_LIMITED"].includes(error.code)) {
                  return false;
                }
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <FeedbackProvider>{children}</FeedbackProvider>
    </QueryClientProvider>
  );
}
