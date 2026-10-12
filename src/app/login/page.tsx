"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { NssLogo } from "@/components/brand/nss-logo";
import { Button, BentoCard } from "@/components/ui/primitives";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
      // Browser is redirected to Google; keep the loading state.
    } catch {
      setError("Could not start sign-in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <BentoCard className="flex flex-col justify-between gap-8 p-8">
          <NssLogo size={56} />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">
              Domain Management Platform
            </h1>
            <p className="mt-2 max-w-md text-sm text-[color:var(--navy-70)]">
              Manage domains, volunteers, events and assignments — with strict,
              server-enforced role and domain access and a full audit trail.
            </p>
          </div>
          <p className="text-[11px] text-[color:var(--navy-45)]">
            Access is limited to approved, verified institutional accounts.
          </p>
        </BentoCard>

        <BentoCard className="flex flex-col justify-center gap-4 p-8">
          <div>
            <h2 className="text-lg font-bold text-[color:var(--brand-navy)]">Sign in</h2>
            <p className="mt-1 text-xs text-[color:var(--navy-45)]">
              Continue with your approved Google account.
            </p>
          </div>

          <Button onClick={signInWithGoogle} loading={loading} className="w-full py-2.5">
            {!loading && (
              <span aria-hidden className="text-base font-bold">
                G
              </span>
            )}
            Continue with Google
          </Button>

          {error && (
            <p role="alert" className="text-xs font-medium text-[color:var(--brand-red)]">
              {error}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-[color:var(--navy-45)]">
            By signing in you agree that your sign-in events and administrative
            actions are recorded in an audit log. Your session is a secure,
            HttpOnly cookie — tokens are never stored in the browser.
          </p>
        </BentoCard>
      </div>
    </main>
  );
}
