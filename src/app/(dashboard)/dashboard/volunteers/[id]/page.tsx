"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import { Badge, Button, Field, Input, Modal, Select, StatusPill, TableShell, Td, Th } from "@/components/ui/primitives";
import { useMe, useProjects, useUpdateVolunteer, useVolunteerDetail } from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import { formatDate } from "@/lib/utils/datetime";
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
  const me = useMe();
  const query = useVolunteerDetail(id);
  const detail = query.data;
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const canEdit = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));

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
        subtitle={detail ? `${detail.domain.name} | ${detail.person.emailNormalized}` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {canEdit && detail && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )}
            {canEdit && detail?.isActive && (
              <Button variant="danger" onClick={() => setRemoving(true)}>
                Remove volunteer
              </Button>
            )}
            <Link href="/dashboard/volunteers" className="btn btn-secondary">
              Back
            </Link>
          </div>
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
              <Row label="Roll number" value={detail.person.rollNumberNormalized ?? "-"} />
              <Row label="Project" value={detail.project?.name ?? "-"} />
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
                        "-"
                      )}
                    </Td>
                    <Td>
                      {a.event                         ? `${formatDate(a.event.startAt)} – ${formatDate(a.event.endAt)}`
                        : "-"}
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
      {editing && detail && <EditVolunteerModal id={id} detail={detail} onClose={() => setEditing(false)} />}
      {removing && detail && <RemoveVolunteerModal id={id} name={detail.person.fullName} onClose={() => setRemoving(false)} />}
    </div>
  );
}

function RemoveVolunteerModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const update = useUpdateVolunteer(id);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    update.mutate(
      { isActive: false },
      {
        onSuccess: onClose,
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not remove volunteer."),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Remove volunteer?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={update.isPending}>Confirm removal</Button>
        </>
      }
    >
      <p>This will deactivate <strong>{name}</strong> from this domain. The action is recorded in the audit log.</p>
      {message && <p className="mt-3 text-xs font-medium text-[color:var(--brand-red)]">{message}</p>}
    </Modal>
  );
}

function EditVolunteerModal({
  id,
  detail,
  onClose,
}: {
  id: string;
  detail: NonNullable<ReturnType<typeof useVolunteerDetail>["data"]>;
  onClose: () => void;
}) {
  const projects = useProjects();
  const update = useUpdateVolunteer(id);
  const [form, setForm] = useState({
    fullName: detail.person.fullName,
    rollNumber: detail.person.rollNumberNormalized ?? "",
    projectId: detail.project?.id ?? "",
    isActive: detail.isActive,
  });
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    update.mutate(
      {
        fullName: form.fullName,
        rollNumber: form.rollNumber || null,
        projectId: form.projectId,
        isActive: form.isActive,
      },
      {
        onSuccess: () => setTimeout(onClose, 600),
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not update member."),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending} disabled={!form.fullName || !form.projectId}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name">
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Roll number">
          <Input value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
        </Field>
        <Field label="Project">
          <Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
            <option value="">Select a project</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.isActive ? "true" : "false"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "true" })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
        {message && <p className="text-xs font-medium text-[color:var(--brand-red)]">{message}</p>}
      </div>
    </Modal>
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
