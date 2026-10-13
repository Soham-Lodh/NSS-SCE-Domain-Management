"use client";

import { useEffect, useRef, useState } from "react";
import { NssLogo } from "@/components/brand/nss-logo";
import { BentoCard, Button } from "@/components/ui/primitives";

export default function UnauthorizedPage() {
  const [signingOut, setSigningOut] = useState(false);
  const started = useRef(false);

  async function signOut() {
    if (started.current) return;
    started.current = true;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.replace("/");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void signOut(), 2500);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <BentoCard className="w-full max-w-xl space-y-6 p-8 text-center">
        <div className="flex justify-center">
          <NssLogo size={52} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">
            Access not approved
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--navy-70)]">
            Your Google sign-in is valid, but this account is not approved for the NSS SCE
            KIIT management portal. Volunteers receive event updates by email and do not
            need portal access.
          </p>
        </div>
        <div className="surface-inset px-4 py-3 text-xs leading-relaxed text-[color:var(--navy-70)]">
          This session will be cleared shortly. Ask a coordinator or tech team member to
          approve a management role, or choose a different account.
        </div>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={signOut} loading={signingOut}>
            Continue with another account
          </Button>
        </div>
      </BentoCard>
    </main>
  );
}
