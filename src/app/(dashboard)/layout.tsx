import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { hasPortalAccess } from "@/lib/authorization/roles";
import { listVisibleDomains } from "@/services/domain-service";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

/**
 * Server-side guard for every dashboard route. An anonymous user is redirected
 * to /login before any private data is rendered; a signed-in account without a
 * portal role (volunteer / unprovisioned) goes to /unauthorized, which clears
 * the session. This is the authoritative boundary; the middleware redirect is
 * only an early UX guard.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext({ provision: true });
  if (!ctx) redirect("/login");
  if (!hasPortalAccess(ctx.roles)) redirect("/unauthorized");

  let domainName: string | null = null;
  if (ctx.domainId) {
    try {
      const domains = await listVisibleDomains(ctx);
      domainName = domains.find((d) => d.id === ctx.domainId)?.name ?? null;
    } catch {
      domainName = null;
    }
  }

  return (
    <AppShell
      fullName={ctx.fullName}
      email={ctx.email}
      role={ctx.role}
      roles={ctx.roles}
      domainName={domainName}
    >
      {children}
    </AppShell>
  );
}
