import Link from "next/link";
import { BentoCard } from "@/components/ui/primitives";
import { NssLogo } from "@/components/brand/nss-logo";

export default function AuthCodeErrorPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <BentoCard className="max-w-md space-y-4 p-8 text-center">
        <div className="flex justify-center">
          <NssLogo size={48} withWordmark={false} />
        </div>
        <h1 className="text-lg font-bold text-[color:var(--brand-navy)]">
          We couldn&apos;t complete sign-in
        </h1>
        <p className="text-sm text-[color:var(--navy-70)]">
          The sign-in link may have expired, been cancelled, or your account may
          not be eligible. Please try again.
        </p>
        <Link href="/login" className="btn btn-primary mx-auto">
          Back to sign in
        </Link>
      </BentoCard>
    </main>
  );
}
