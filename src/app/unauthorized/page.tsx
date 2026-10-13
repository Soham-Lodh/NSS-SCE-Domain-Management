"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NssLogo } from "@/components/brand/nss-logo";
import { BentoCard, Button } from "@/components/ui/primitives";

export default function UnauthorizedPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

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
            Your Google sign-in is valid, but this account has not been assigned as a
            volunteer, domain lead, tech team member, or coordinator in the NSS SCE KIIT
            platform.
          </p>
        </div>
        <div className="surface-inset px-4 py-3 text-xs leading-relaxed text-[color:var(--navy-70)]">
          Ask a coordinator or tech team member to add your account. If you used the
          wrong Google account, sign out and choose the approved account.
        </div>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={signOut} loading={signingOut}>
            Sign out
          </Button>
        </div>
      </BentoCard>
    </main>
  );
}
