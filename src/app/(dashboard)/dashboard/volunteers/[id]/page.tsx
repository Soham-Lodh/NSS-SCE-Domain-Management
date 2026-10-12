"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import { Badge, StatusPill, TableShell, Td, Th } from "@/components/ui/primitives";
import { useVolunteerDetail } from "@/hooks/api-hooks";
import type { AssignmentDTO } from "@/lib/types/api";

function categorize(a: AssignmentDTO): "COMPLETED" | "UPCOMING" | "ONGOING" | "PAST" | "CANCELLED" {
  if (!a.event) return "PAST";
  if (a.event.status === "CANCELLED") return "CANCELLED";
  if (a.status === "COMPLETED") return "COMPLETED";
  const now = Date.now();
  const start = new Date(a.event.startAt).getTime();
  const end = new Date(a.event.endAt).getTime();
  if (now < start) return "UPCOMING";
  if (now < end) return "ONGOING";
  return "PAST";
}

export default function VolunteerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useVolunteerDetail(id);
  const detail = query.data;

  const groups = {
    COMPLETED: [] as AssignmentDTO[],
    UPCOMING: [] as AssignmentDTO[],
    ONGOING: [] as AssignmentDTO[],
    PAST: [] as AssignmentDTO[],
    CANCELLED: [] as AssignmentDTO[],
  };
  for (const a of detail?.assignments ?? []) groups[categorize(a)].push(a);

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail?.person.fullName ?? "Member"}
        subtitle={detail ? `${detail.domain.name} · ${detail.person.emailNormalized}` : undefined}
        action={
          <Link href="/dashboard/volunteers" className="btn btn-secondary">
            ← Back
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <DataPanel
          title="Profile"
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={!detail}
          emptyTitle="Member not found"
          onRetry={() => query.refetch()}
        >
          {detail && (
            <dl className="space-y-2 text-sm">
              <Row label="Roll number" value={detail.person.rollNumberNormalized ?? "—"} />
              <Row label="Project" value={detail.project?.name ?? "—"} />
              <Row
                label="Status"
                value={
                  <StatusPill label={detail.isActive ? "Active" : "Inactive"} tone={detail.isActive ? "success" : "neutral"} />
                }
              />
              <Row label="Completed" value={String(groups.COMPLETED.length)} />
              <Row label="Upcoming" value={String(groups.UPCOMING.length)} />
            </dl>
          )}
        </DataPanel>

        <DataPanel
          title="Assignment history"
          subtitle="Completed, ongoing, upcoming and past assignments"
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={(detail?.assignments.length ?? 0) === 0}
          emptyTitle="No assignments yet"
          onRetry={() => query.refetch()}
          rowSkeletonCount={6}
        >
          <TableShell>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>Dates</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {detail?.assignments.map((a) => {
                const cat = categorize(a);
                return (
                  <tr key={a.id}>
                    <Td>
                      {a.event ? (
                        <Link
                          href={`/dashboard/events/${a.event.id}`}
                          className="font-semibold text-[color:var(--brand-navy)] hover:underline"
                        >
                          {a.event.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {a.event
                        ? `${new Date(a.event.startAt).toLocaleDateString()} – ${new Date(a.event.endAt).toLocaleDateString()}`
                        : "—"}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <StatusPill
                          label={a.status === "COMPLETED" ? "Completed" : "Assigned"}
                          tone={a.status === "COMPLETED" ? "success" : "neutral"}
                        />
                        {cat === "CANCELLED" && <Badge tone="danger">Event cancelled</Badge>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </DataPanel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--navy-06)] pb-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]">{label}</dt>
      <dd className="text-sm font-medium text-[color:var(--brand-navy)]">{value}</dd>
    </div>
  );
}
