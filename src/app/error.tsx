"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";

/**
 * Route-level error boundary. Catches uncaught render/handler errors and shows
 * a friendly, on-brand page instead of Next's default error screen. Never
 * exposes stack traces or secrets to the user.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for local debugging; no secrets are attached.
    console.error("route_error", error?.message, error?.digest);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="surface-raised w-full max-w-md p-8 text-center">
        <p
          aria-hidden
          className="text-4xl font-extrabold tracking-tight text-[color:var(--brand-red)]"
        >
          !
        </p>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[color:var(--navy-70)]">
          An unexpected error occurred while loading this page. Your data is
          safe. You can try again, or sign out and back in.
        </p>
        {error?.digest && (
          <p className="mt-2 text-[11px] text-[color:var(--navy-45)]">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </main>
  );
}
