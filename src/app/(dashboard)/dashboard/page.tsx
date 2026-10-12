"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel, StatCard } from "@/components/dashboard/data-panel";
import { Badge, Button, SkeletonCards } from "@/components/ui/primitives";
import { useAnalytics, useMe } from "@/hooks/api-hooks";
import { ROLE_LABELS } from "@/lib/auth/types";

export default function DashboardPage() {
  const me = useMe();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));
  const scope = isOversight && !me.data?.domainId ? "all" : "domain";

  const analytics = useAnalytics(me.data?.domainId ?? undefined, scope);

  const totals = useMemo(() => {
    const rows = analytics.data?.domains ?? [];
    return rows.reduce(
      (acc, d) => ({
        volunteers: acc.volunteers + d.activeVolunteers,
        events: acc.events + d.events,
        upcoming: acc.upcoming + d.upcomingEvents,
        completions: acc.completions + d.completions,
      }),
      { volunteers: 0, events: 0, upcoming: 0, completions: 0 },
    );
  }, [analytics.data]);

  const showVolunteers = isOversight || !!me.data?.domainId;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome${me.data ? `, ${me.data.fullName.split(" ")[0]}` : ""}`}
        subtitle="An overview of the volunteers, events and assignments you can access."
        action={me.data && <Badge tone="accent">{ROLE_LABELS[me.data.role]}</Badge>}
      />

      {me.isLoading ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active volunteers" value={totals.volunteers} loading={analytics.isLoading} />
          <StatCard label="Total events" value={totals.events} loading={analytics.isLoading} />
          <StatCard label="Upcoming events" value={totals.upcoming} loading={analytics.isLoading} />
          <StatCard label="Completions" value={totals.completions} loading={analytics.isLoading} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <DataPanel
          title="Domains"
          subtitle={scope === "all" ? "All active domains" : "Your domain"}
          isLoading={analytics.isLoading}
          isError={analytics.isError}
          error={analytics.error}
          isEmpty={(analytics.data?.domains.length ?? 0) === 0}
          emptyTitle="No domains available"
          onRetry={() => analytics.refetch()}
          rowSkeletonCount={3}
          action={
            <Button variant="secondary" onClick={() => analytics.refetch()} loading={analytics.isFetching}>
              Refresh
            </Button>
          }
        >
          <ul className="space-y-2">
            {analytics.data?.domains.map((d) => (
              <li key={d.domainId} className="surface-inset flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--brand-navy)]">{d.domainName}</p>
                  <p className="text-[11px] text-[color:var(--navy-45)]">
                    {d.activeVolunteers} active volunteers · {d.events} events
                  </p>
                </div>
                <div className="flex gap-1">
                  <Badge>{d.upcomingEvents} upcoming</Badge>
                  <Badge>{d.completions} completed</Badge>
                </div>
              </li>
            ))}
          </ul>
        </DataPanel>

        <DataPanel
          title="Quick actions"
          subtitle="Jump to the areas available to your role"
          isLoading={me.isLoading}
          isError={false}
          error={null}
          isEmpty={false}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {showVolunteers && (
              <Link href="/dashboard/volunteers" className="btn btn-secondary justify-start">
                ◫ Volunteer database
              </Link>
            )}
            {showVolunteers && (
              <Link href="/dashboard/events" className="btn btn-secondary justify-start">
                ◨ Events
              </Link>
            )}
            {isOversight && (
              <Link href="/dashboard/users" className="btn btn-secondary justify-start">
                ◉ Users &amp; roles
              </Link>
            )}
            {isOversight && (
              <Link href="/dashboard/audit-logs" className="btn btn-secondary justify-start">
                ☰ Audit logs
              </Link>
            )}
          </div>
        </DataPanel>
      </div>
    </div>
  );
}
