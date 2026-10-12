"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  StatusPill,
  TableShell,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  useAssignmentAction,
  useBulkAssign,
  useEventDetail,
  useEventLifecycle,
  useEvents,
  useMe,
  useVolunteers,
} from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import type { AssignmentDTO, BulkAssignSummaryDTO, EventDetailDTO } from "@/lib/types/api";

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const me = useMe();
  const query = useEventDetail(eventId);
  const event = query.data;
  const canOperate = !!me.data?.domainId && me.data.roles.includes("DOMAIN_LEAD") && event?.domainId === me.data.domainId;

  const [assigning, setAssigning] = useState(false);
  const lifecycle = useEventLifecycle(eventId);
  const isEnded = event?.status === "COMPLETED";

  return (
    <div className="space-y-4">
      <PageHeader
        title={event?.title ?? "Event"}
        subtitle={event ? `${event.domain.name} · ${new Date(event.startAt).toLocaleString()}` : undefined}
        action={
          <div className="flex gap-2">
            {canOperate && event && (
              <Button
                variant={isEnded ? "secondary" : "primary"}
                loading={lifecycle.isPending}
                onClick={() => lifecycle.mutate(isEnded ? "reopen" : "complete")}
              >
                {isEnded ? "↺ Re-open task" : "✓ End task"}
              </Button>
            )}
            <Link href="/dashboard/events" className="btn btn-secondary">
              ← Back
            </Link>
          </div>
        }
      />

      {isEnded && (
        <div className="surface-inset px-4 py-2 text-xs text-[color:var(--navy-70)]">
          This task was ended by a domain lead. While ended, it will not send deadline reminders.
          Use “Re-open task” if it was ended by mistake.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <DataPanel
          title="Details"
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={!event}
          emptyTitle="Event not found"
          onRetry={() => query.refetch()}
        >
          {event && <EventMeta event={event} />}
        </DataPanel>

        <DataPanel
          title="Assigned volunteers"
          subtitle={event ? `${event.assignments.length} assignment(s)` : undefined}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={(event?.assignments.length ?? 0) === 0}
          emptyTitle="No volunteers assigned"
          emptyDescription={canOperate ? "Use “Assign volunteers” to add members." : undefined}
          onRetry={() => query.refetch()}
          rowSkeletonCount={5}
          action={
            canOperate && (
              <Button onClick={() => setAssigning(true)}>+ Assign volunteers</Button>
            )
          }
        >
          <TableShell>
            <thead>
              <tr>
                <Th>Volunteer</Th>
                <Th>Roll no.</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {event?.assignments.map((a) => (
                <AssignmentRow key={a.id} assignment={a} canOperate={canOperate} eventId={eventId} />
              ))}
            </tbody>
          </TableShell>
        </DataPanel>
      </div>

      {canOperate && event && (
        <BulkAssignModal open={assigning} onClose={() => setAssigning(false)} eventId={eventId} domainId={event.domainId} />
      )}
    </div>
  );
}

function EventMeta({ event }: { event: EventDetailDTO }) {
  const scheduled = event.status === "SCHEDULED";
  return (
    <dl className="space-y-2 text-sm">
      <MetaRow label="Status">
        <StatusPill
          label={event.status}
          tone={
            event.status === "CANCELLED"
              ? "danger"
              : event.status === "COMPLETED"
                ? "success"
                : scheduled
                  ? "accent"
                  : "neutral"
          }
        />
      </MetaRow>
      <MetaRow label="Deadline">{new Date(event.endAt).toLocaleString()}</MetaRow>
      <MetaRow label="Starts">{new Date(event.startAt).toLocaleString()}</MetaRow>
      <MetaRow label="Ends">{new Date(event.endAt).toLocaleString()}</MetaRow>
      <MetaRow label="Location">{event.location ?? "—"}</MetaRow>
      <MetaRow label="Created by">{event.createdBy.person.fullName}</MetaRow>
      {event.description && (
        <div className="surface-inset mt-2 p-3 text-xs text-[color:var(--navy-70)]">{event.description}</div>
      )}
    </dl>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--navy-06)] pb-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]">{label}</dt>
      <dd className="text-sm font-medium text-[color:var(--brand-navy)]">{children}</dd>
    </div>
  );
}

function AssignmentRow({
  assignment,
  canOperate,
  eventId,
}: {
  assignment: AssignmentDTO;
  canOperate: boolean;
  eventId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useAssignmentAction(assignment.id);
  const [reassignOpen, setReassignOpen] = useState(false);

  function run(body: Parameters<typeof action.mutate>[0]) {
    setBusy(true);
    setError(null);
    action.mutate(body, {
      onSettled: () => setBusy(false),
      onError: (err) => setError(err instanceof ApiClientError ? err.message : "Action failed."),
    });
  }

  return (
    <tr>
      <Td>
        <span className="font-semibold text-[color:var(--brand-navy)]">
          {assignment.membership?.person.fullName ?? "—"}
        </span>
        {error && <span className="block text-[11px] text-[color:var(--brand-red)]">{error}</span>}
      </Td>
      <Td>{assignment.membership?.person.rollNumberNormalized ?? "—"}</Td>
      <Td>
        <StatusPill
          label={assignment.status === "COMPLETED" ? "Completed" : "Assigned"}
          tone={assignment.status === "COMPLETED" ? "success" : "neutral"}
        />
      </Td>
      <Td>
        {canOperate ? (
          <div className="flex justify-end gap-1">
            {assignment.status === "ASSIGNED" ? (
              <Button variant="secondary" className="px-2 py-1 text-xs" loading={busy} onClick={() => run({ action: "complete" })}>
                Mark complete
              </Button>
            ) : (
              <Button variant="secondary" className="px-2 py-1 text-xs" loading={busy} onClick={() => run({ action: "reopen" })}>
                Reopen
              </Button>
            )}
            <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => setReassignOpen(true)}>
              Reassign
            </Button>
            <Button variant="danger" className="px-2 py-1 text-xs" loading={busy} onClick={() => run({ action: "remove" })}>
              Remove
            </Button>
          </div>
        ) : (
          <Badge>View only</Badge>
        )}
      </Td>

      {reassignOpen && (
        <ReassignModal
          assignmentId={assignment.id}
          currentEventId={eventId}
          onClose={() => setReassignOpen(false)}
        />
      )}
    </tr>
  );
}

function ReassignModal({ assignmentId, currentEventId, onClose }: { assignmentId: string; currentEventId: string; onClose: () => void }) {
  const me = useMe();
  const domainId = me.data?.domainId ?? undefined;
  const eventsQuery = useEvents({ domainId, category: "ALL", limit: 50 });
  const events = (eventsQuery.data?.items ?? []).filter(
    (e) => e.id !== currentEventId && e.category !== "CANCELLED" && e.category !== "PAST",
  );
  const action = useAssignmentAction(assignmentId, "assignment");

  return (
    <Modal open onClose={onClose} title="Reassign to another event">
      <div className="space-y-2">
        {events.length === 0 ? (
          <EmptyState title="No other events" description="There are no other events in this domain to move to." />
        ) : (
          events.map((e) => (
            <div key={e.id} className="surface-inset flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm font-medium text-[color:var(--brand-navy)]">{e.title}</span>
              <Button
                variant="secondary"
                className="px-3 py-1 text-xs"
                loading={action.isPending}
                onClick={() => action.mutate({ action: "reassign", targetEventId: e.id }, { onSuccess: onClose })}
              >
                Move here
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function BulkAssignModal({ open, onClose, eventId, domainId }: { open: boolean; onClose: () => void; eventId: string; domainId: string }) {
  const members = useVolunteers({ domainId, activeOnly: true, limit: 100 });
  const assign = useBulkAssign(eventId);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<BulkAssignSummaryDTO | null>(null);

  const filtered = (members.data?.items ?? []).filter(
    (m) =>
      !search ||
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (m.rollNumber ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function submit() {
    assign.mutate(Array.from(selected), {
      onSuccess: (res) => {
        setSummary(res);
        setSelected(new Set());
      },
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign volunteers"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={submit} loading={assign.isPending} disabled={selected.size === 0}>
            Assign {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Search members">
          <Input placeholder="Name or roll number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>

        {members.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No active members" description="Add volunteers to this domain first." />
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filtered.map((m) => (
              <label
                key={m.membershipId}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-[color:var(--navy-06)]"
              >
                <span>
                  <span className="text-sm font-medium text-[color:var(--brand-navy)]">{m.fullName}</span>
                  <span className="ml-2 text-[11px] text-[color:var(--navy-45)]">{m.rollNumber ?? ""}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[color:var(--brand-navy)]"
                  checked={selected.has(m.membershipId)}
                  onChange={() => toggle(m.membershipId)}
                />
              </label>
            ))}
          </div>
        )}

        {summary && (
          <div className="surface-inset space-y-1 p-3 text-xs">
            <p className="font-semibold text-[color:var(--brand-navy)]">Result</p>
            <p>Assigned: {summary.assigned}</p>
            <p>Already assigned: {summary.alreadyAssigned}</p>
            <p>Rejected: {summary.rejected}</p>
          </div>
        )}
        {assign.isError && (
          <p className="text-xs font-medium text-[color:var(--brand-red)]">
            {assign.error instanceof ApiClientError ? assign.error.message : "Assignment failed."}
          </p>
        )}
      </div>
    </Modal>
  );
}
