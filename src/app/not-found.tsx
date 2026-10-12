import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="surface-raised w-full max-w-md p-8 text-center">
        <p
          aria-hidden
          className="text-4xl font-extrabold tracking-tight text-[color:var(--brand-navy)]"
        >
          404
        </p>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[color:var(--navy-70)]">
          The page you are looking for does not exist or you may not have
          access to it.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/dashboard">
            <Button>Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
