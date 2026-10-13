"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { NssLogo } from "@/components/brand/nss-logo";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";
import type { AppRole } from "@/lib/auth/types";
import { ROLE_LABELS } from "@/lib/auth/types";

type NavItem = { href: string; label: string; icon: string; roles: AppRole[] | "ALL" };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", roles: "ALL" },
  { href: "/dashboard/volunteers", label: "Volunteers", icon: "◫", roles: ["DOMAIN_LEAD", "TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/events", label: "Events", icon: "◨", roles: ["DOMAIN_LEAD", "TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/domains", label: "Domains", icon: "◧", roles: ["TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/users", label: "Users & Roles", icon: "◉", roles: ["TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/email-logs", label: "Email Logs", icon: "✉", roles: ["TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/audit-logs", label: "Audit Logs", icon: "☰", roles: ["TECH_TEAM", "COORDINATOR"] },
  { href: "/dashboard/settings", label: "Settings", icon: "⚙", roles: "ALL" },
];

export function AppShell({
  children,
  fullName,
  email,
  role,
  roles,
  domainName,
}: {
  children: ReactNode;
  fullName: string;
  email: string;
  role: AppRole;
  roles: AppRole[];
  domainName: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const visible = NAV.filter(
    (item) => item.roles === "ALL" || item.roles.some((r) => roles.includes(r)),
  );

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    if (drawerOpen) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Hard-reset the client cache so the next user on this device can never
      // see the previous user's private data.
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    }
  }

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  }

  function navLinks(onClick?: () => void, extraClass = ""): ReactNode {
    return visible.map((item) => {
      const active = isActive(item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition duration-150 ease-smooth",
            active
              ? "bg-[color:var(--navy-10)] text-[color:var(--brand-navy)] shadow-inset"
              : "text-[color:var(--navy-70)] hover:bg-[color:var(--navy-06)] hover:text-[color:var(--brand-navy)]",
            extraClass,
          )}
        >
          <span aria-hidden className="w-4 text-center">{item.icon}</span>
          {item.label}
        </Link>
      );
    });
  }

  const userBlock = (
    <div className="space-y-3 border-t border-[color:var(--navy-10)] pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-[color:var(--brand-navy)]">{fullName}</p>
        <p className="truncate text-[11px] text-[color:var(--navy-45)]">{email}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone="accent">{ROLE_LABELS[role]}</Badge>
          {domainName && <Badge>{domainName}</Badge>}
        </div>
      </div>
      <Button variant="secondary" onClick={signOut} loading={signingOut} className="w-full">
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:grid lg:grid-cols-[260px_1fr] lg:gap-4 lg:p-4">
      {/* Mobile header */}
      <header className="surface-raised sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <NssLogo size={32} />
          <span className="truncate text-sm font-extrabold text-[color:var(--brand-navy)]">NSS SCE KIIT</span>
        </div>
        <button
          type="button"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          onClick={() => setDrawerOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[color:var(--brand-navy)] hover:bg-[color:var(--navy-06)]"
        >
          <span aria-hidden className="text-lg">{drawerOpen ? "✕" : "☰"}</span>
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-[color:var(--navy-70)]/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="surface-raised absolute inset-y-0 right-0 flex w-[min(84vw,320px)] flex-col gap-4 overflow-y-auto p-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <NssLogo size={36} />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[color:var(--brand-navy)] hover:bg-[color:var(--navy-06)]"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
            <nav aria-label="Primary" className="flex flex-col gap-1">
              {navLinks(() => setDrawerOpen(false))}
            </nav>
            <div className="mt-auto">{userBlock}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden surface-raised flex-col gap-4 p-4 lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)]">
        <NssLogo size={40} />
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {navLinks()}
        </nav>
        <div className="mt-auto">{userBlock}</div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 p-4 lg:p-0">{children}</main>
    </div>
  );
}

/** Standard bento page header used across dashboard pages. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[color:var(--navy-45)]">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
