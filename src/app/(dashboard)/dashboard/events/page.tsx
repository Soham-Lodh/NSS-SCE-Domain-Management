"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
} from "@/components/ui/primitives";
import { useCreateEvent, useEvents, useMe } from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import { formatDateTime } from "@/lib/utils/datetime";
import type { EventCardDTO } from "@/lib/types/api";

type Tab = "ALL" | "UPCOMING" | "ONGOING" | "PAST" | "COMPLETED" | "CANCELLED";

function normalizeEventLink(link: { name: string; url: string }) {
  const url = link.url.trim();
  return { name: link.name.trim(), url: /^https?:\/\//i.test(url) ? url : `https://${url}` };
}

function toneFor(cat: EventCardDTO["category"]) {
  if (cat === "CANCELLED") return "danger" as const;
  if (cat === "COMPLETED") return "success" as const;
  if (cat === "ONGOING") return "accent" as const;
  if (cat === "PAST") return "neutral" as const;
  return "accent" as const;
}

export default function EventsPage() {
  const me = useMe();
  const DOMAINS = [
  {
    id: "2a05ced4-a265-4569-a975-917c2f536957",
    name: "Content Writing",
  },
  {
    id: "7fa9baea-ab43-4d87-ba13-06acad9ff50b",
    name: "Graphic Designing",
  },
  {
    id: "a9975a53-fd65-4ed7-9044-c1d3715af08c",
    name: "Video Editing",
  },
  {
      id:"a04a8ae8-dfc0-4197-b707-e6c43f7cb3ad",
      name:"Photography",
    }
] as const;
  const leadDomainIds = me.data?.domainIds ?? [];
  const isDomainLead = me.data?.roles.includes("DOMAIN_LEAD") ?? false;
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));
  const canViewAllDomains = !!me.data && (isOversight || me.data.roles.includes("SOCIALS"));

  const [tab, setTab] = useState<Tab>("ALL");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [creating, setCreating] = useState(false);

  const canViewPhotography = isDomainLead;
  const mustChooseDomain = canViewAllDomains || isDomainLead || leadDomainIds.length > 1;
  const effectiveDomainId = mustChooseDomain ? selectedDomain || undefined : leadDomainIds[0];
  const canOperate = !!effectiveDomainId && isDomainLead && leadDomainIds.includes(effectiveDomainId);
  const waitingForDomainSelection = mustChooseDomain && !effectiveDomainId;
  const query = useEvents({ domainId: effectiveDomainId, category: tab, limit: 24 });

  useEffect(() => {
    setTab("ALL");
  }, [effectiveDomainId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Events"
        subtitle="Sorted by date. Past events stay open until a domain lead ends them."
        action={
          canOperate && <Button onClick={() => setCreating(true)}>Create event</Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "ALL", label: "All" },
            { value: "UPCOMING", label: "Upcoming" },
            { value: "ONGOING", label: "Ongoing" },
            { value: "PAST", label: "Past (open)" },
            { value: "COMPLETED", label: "Completed" },
            { value: "CANCELLED", label: "Cancelled" },
          ]}
        />
        {mustChooseDomain && (
          <Field label="Domain">
            <Select value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value)}>
              <option value="">Select a domain</option>
              {DOMAINS.filter((d) => canViewAllDomains || leadDomainIds.includes(d.id) || (canViewPhotography && d.name === "Photography")).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <DataPanel
        title="Event cards"
        subtitle={query.data ? `${query.data.total} event(s)` : undefined}
        isLoading={me.isLoading || (!!effectiveDomainId && query.isLoading)}
        isRefreshing={
          !!effectiveDomainId &&
          (query.isPlaceholderData || (query.isFetching && !query.isLoading))
        }
        isError={!waitingForDomainSelection && query.isError}
        error={query.error}
        isEmpty={waitingForDomainSelection || (query.data?.items.length ?? 0) === 0}
        emptyTitle={waitingForDomainSelection ? "Please select a filter to see details" : "No events here"}
        emptyDescription={
          waitingForDomainSelection
            ? "Choose a domain in the filter above to see its events."
            : "Events you can access will appear here, sorted by date."
        }
        onRetry={() => query.refetch()}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="surface-raised space-y-3 p-5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            ))}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {query.data?.items.map((e) => (
            <Link
              key={e.id}
              href={`/dashboard/events/${e.id}`}
              className="surface-raised flex flex-col gap-3 p-5 transition duration-150 ease-smooth hover:shadow-raised-hover"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-[color:var(--brand-navy)]">{e.title}</h3>
                <StatusPill label={e.category} tone={toneFor(e.category)} />
              </div>
              <p className="text-[11px] text-[color:var(--navy-45)]">
                {formatDateTime(e.startAt)} to {formatDateTime(e.endAt)}
              </p>
              {e.location && <p className="text-[11px] text-[color:var(--navy-70)]">{e.location}</p>}
              <div className="mt-auto flex flex-wrap gap-1">
                <Badge>{e.assignedCount} assigned</Badge>
                <Badge tone="accent">{e.completedCount} completed</Badge>
              </div>
            </Link>
          ))}
        </div>
      </DataPanel>

      {canOperate && effectiveDomainId && (
        <CreateEventModal open={creating} onClose={() => setCreating(false)} domainId={effectiveDomainId} />
      )}
    </div>
  );
}

function CreateEventModal({
  open,
  onClose,
  domainId,
}: {
  open: boolean;
  onClose: () => void;
  domainId: string;
}) {
  const create = useCreateEvent();
  const [form, setForm] = useState({ title: "", description: "", location: "", startAt: "", endAt: "", links: [] as { name: string; url: string }[] });
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    create.mutate(
      {
        domainId,
        title: form.title,
        description: form.description || null,
        location: form.location || null,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        links: form.links.filter((link) => link.name.trim() && link.url.trim()).map(normalizeEventLink),
      },
      {
        onSuccess: () => {
          setMessage("Event created.");
          setTimeout(onClose, 600);
        },
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not create event."),
      },
    );
  }

  const valid = form.title.length >= 3 && !!form.startAt && !!form.endAt;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create event"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!valid}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Description" hint="Optional">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Location" hint="Optional">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts at">
            <Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
          </Field>
          <Field label="Ends at">
            <Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
          </Field>
        </div>
        <Field label="Drive links" hint="Optional. Add a name and the full link.">
          <div className="space-y-2">
            {form.links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <Input placeholder="Link name" value={link.name} onChange={(e) => setForm({ ...form, links: form.links.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} />
                <Input placeholder="https://drive.google.com/..." value={link.url} onChange={(e) => setForm({ ...form, links: form.links.map((item, i) => i === index ? { ...item, url: e.target.value } : item) })} />
                <Button variant="secondary" onClick={() => setForm({ ...form, links: form.links.filter((_, i) => i !== index) })}>Remove</Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setForm({ ...form, links: [...form.links, { name: "", url: "" }] })}>+ Add link</Button>
          </div>
        </Field>
        {message && <p className="text-xs font-medium text-[color:var(--brand-navy)]">{message}</p>}
      </div>
    </Modal>
  );
}
