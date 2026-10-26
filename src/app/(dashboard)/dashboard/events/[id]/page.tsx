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
  useDeleteEvent,
  useUpdateEvent,
  useEvents,
  useMe,
  useVolunteers,
} from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import { formatDateTime } from "@/lib/utils/datetime";
import type { AssignmentDTO, BulkAssignSummaryDTO, EventDetailDTO } from "@/lib/types/api";

function normalizeEventLink(link: { name: string; url: string }) {
  const url = link.url.trim();
  return { name: link.name.trim(), url: /^https?:\/\//i.test(url) ? url : `https://${url}` };
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const me = useMe();
  const query = useEventDetail(eventId);
  const event = query.data;
  const canOperate = !!event && (me.data?.roles.includes("DOMAIN_LEAD") ?? false) && (me.data?.domainIds ?? []).includes(event.domainId);
  const remove = useDeleteEvent(eventId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  const [assigning, setAssigning] = useState(false);
  const lifecycle = useEventLifecycle(eventId);
  const isEnded = event?.status === "COMPLETED";

  return (
    <div className="space-y-4">
      <PageHeader
        title={event?.title ?? "Event"}
        subtitle={event ? `${event.domain.name} | ${formatDateTime(event.startAt)}` : undefined}
        action={
          <div className="flex gap-2">
            {canOperate && event && (
              <Button
                variant={isEnded ? "secondary" : "primary"}
                loading={lifecycle.isPending}
                onClick={() => lifecycle.mutate(isEnded ? "reopen" : "complete")}
              >
                {isEnded ? "Re-open task" : "End task"}
              </Button>
            )}
            {canOperate && event && <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete event</Button>}
            {canOperate && event && <Button variant="secondary" onClick={() => setEditing(true)}>Edit event</Button>}
            <Link href="/dashboard/events" className="btn btn-secondary">
              Back
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
          emptyDescription={canOperate && !isEnded ? "Use “Assign volunteers” to add members." : undefined}
          onRetry={() => query.refetch()}
          rowSkeletonCount={5}
          action={
            canOperate && !isEnded && (
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
                <AssignmentRow key={a.id} assignment={a} canOperate={canOperate && !isEnded} eventId={eventId} domainId={event?.domainId ?? ""} />
              ))}
            </tbody>
          </TableShell>
        </DataPanel>
      </div>

      {canOperate && event && !isEnded && (
        <BulkAssignModal open={assigning} onClose={() => setAssigning(false)} eventId={eventId} domainId={event.domainId} />
      )}
      {confirmDelete && event && (
        <Modal open onClose={() => setConfirmDelete(false)} title="Delete event?" footer={<><Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirmDelete(false) })}>Confirm delete</Button></>}>
          <p>This permanently deletes <strong>{event.title}</strong>, its assignments, and assignment history. The action is audited.</p>
        </Modal>
      )}
      {editing && event && <EditEventModal event={event} onClose={() => setEditing(false)} />}
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
      <MetaRow label="Starts">{formatDateTime(event.startAt)}</MetaRow>
      <MetaRow label="Ends (deadline)">{formatDateTime(event.endAt)}</MetaRow>
      <MetaRow label="Location">{event.location ?? "-"}</MetaRow>
      <MetaRow label="Created by">{event.createdBy.person.fullName}</MetaRow>
      {event.description && (
        <div className="surface-inset mt-2 p-3 text-xs text-[color:var(--navy-70)]">{event.description}</div>
      )}
      {event.links.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]">Resources</p>
          {event.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="block text-xs font-semibold text-[color:var(--brand-blue)] hover:underline">{link.name}</a>)}
        </div>
      )}
    </dl>
  );
}

function EditEventModal({ event, onClose }: { event: EventDetailDTO; onClose: () => void }) {
  const update = useUpdateEvent(event.id);
  const [form, setForm] = useState({ title: event.title, description: event.description ?? "", location: event.location ?? "", startAt: new Date(event.startAt).toISOString().slice(0, 16), endAt: new Date(event.endAt).toISOString().slice(0, 16), links: event.links.map(({ name, url }) => ({ name, url })) });
  const [error, setError] = useState<string | null>(null);
  function submit() {
    setError(null);
    update.mutate({ title: form.title, description: form.description || null, location: form.location || null, startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(), links: form.links.filter((link) => link.name.trim() && link.url.trim()).map(normalizeEventLink) }, { onSuccess: onClose, onError: (e) => setError(e instanceof ApiClientError ? e.message : "Could not update event.") });
  }
  return <Modal open onClose={onClose} title="Edit event" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={update.isPending} disabled={!form.title || !form.startAt || !form.endAt}>Save changes</Button></>}>
    <div className="space-y-3">
      <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Starts at"><Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></Field><Field label="Ends at"><Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></Field></div>
      <Field label="Event links" hint="Edit names/URLs, remove old links, or add new ones.">
        <div className="space-y-2">{form.links.map((link, index) => <div key={index} className="flex gap-2"><Input placeholder="Link name" value={link.name} onChange={(e) => setForm({ ...form, links: form.links.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} /><Input placeholder="https://..." value={link.url} onChange={(e) => setForm({ ...form, links: form.links.map((item, i) => i === index ? { ...item, url: e.target.value } : item) })} /><Button variant="secondary" onClick={() => setForm({ ...form, links: form.links.filter((_, i) => i !== index) })}>Remove</Button></div>)}<Button variant="secondary" onClick={() => setForm({ ...form, links: [...form.links, { name: "", url: "" }] })}>+ Add link</Button></div>
      </Field>
      {error && <p className="text-xs text-[color:var(--brand-red)]">{error}</p>}
    </div>
  </Modal>;
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
  domainId,
}: {
  assignment: AssignmentDTO;
  canOperate: boolean;
  eventId: string;
  domainId: string;
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
          {assignment.membership?.person.fullName ?? "-"}
        </span>
        {error && <span className="block text-[11px] text-[color:var(--brand-red)]">{error}</span>}
      </Td>
      <Td>{assignment.membership?.person.rollNumberNormalized ?? "-"}</Td>
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
          domainId={domainId}
          onClose={() => setReassignOpen(false)}
        />
      )}
    </tr>
  );
}

function ReassignModal({ assignmentId, currentEventId, domainId, onClose }: { assignmentId: string; currentEventId: string; domainId: string; onClose: () => void }) {
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
}function BulkAssignModal({ open, onClose, eventId, domainId }: { open: boolean; onClose: () => void; eventId: string; domainId: string }) {
  const [search, setSearch] = useState("");
  // Server-side least-loaded-first ordering (Total asc → Assigned asc → roll no
  // → name). Search is passed through so pagination never loses members.
  const members = useVolunteers({ domainId, search, activeOnly: true, sort: "workload", limit: 100 });
  const assign = useBulkAssign(eventId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<BulkAssignSummaryDTO | null>(null);

  const list = members.data?.items ?? [];

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
        <p className="text-[11px] text-[color:var(--navy-45)]">
          Members with fewer total events appear first.
        </p>

        {members.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={search ? "No matching members" : "No active members"}
            description={search ? "Try a different name or roll number." : "Add volunteers to this domain first."}
          />
        ) : (
          <div className="min-w-max max-h-80 overflow-auto rounded-lg border border-[color:var(--navy-06)]">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[color:var(--navy-04)] text-[11px] uppercase tracking-wide text-[color:var(--navy-45)]">
                <tr>
                  <Th className="px-3 py-2">Roll No.</Th>
                  <Th className="px-3 py-2">Name</Th>
                  <Th className="px-3 py-2 text-right" title="Currently open assignments">Assigned</Th>
                  <Th className="px-3 py-2 text-right">Completed</Th>
                  <Th className="px-3 py-2 text-right" title="Assigned + Completed (cancelled/archived events excluded)">Total</Th>
                  <Th className="px-3 py-2 text-center">Select</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={m.membershipId}
                    className="cursor-pointer border-t border-[color:var(--navy-06)] hover:bg-[color:var(--navy-04)]"
                    onClick={() => toggle(m.membershipId)}
                  >
                    <Td className="px-3 py-2 whitespace-nowrap text-[color:var(--navy-70)]">{m.rollNumber ?? "-"}</Td>
                    <Td className="px-3 py-2 font-medium text-[color:var(--brand-navy)]">{m.fullName}</Td>
                    <Td className="px-3 py-2 text-right">{m.assignedCount}</Td>
                    <Td className="px-3 py-2 text-right">{m.completedCount}</Td>
                    <Td className="px-3 py-2 text-right font-semibold text-[color:var(--brand-navy)]">{m.totalCount}</Td>
                    <Td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${m.fullName}`}
                        className="h-4 w-4 accent-[color:var(--brand-navy)]"
                        checked={selected.has(m.membershipId)}
                        onChange={() => toggle(m.membershipId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {members.isError && (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-[color:var(--brand-red)]">
              Could not load members.
            </p>
            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => members.refetch()}>
              Retry
            </Button>
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
