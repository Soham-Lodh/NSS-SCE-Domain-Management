"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel, StatCard } from "@/components/dashboard/data-panel";
import { Badge, Button, Field, Input, Modal, SkeletonCards } from "@/components/ui/primitives";
import { useAnalytics, useCreateDomain, useMe } from "@/hooks/api-hooks";
import { PermissionDenied } from "@/components/ui/primitives";
import { ApiClientError } from "@/lib/http/client";

export default function DomainsPage() {
  const me = useMe();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));
  const analytics = useAnalytics(undefined, "all");
  const [adding, setAdding] = useState(false);

  if (me.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Domains" />
        <SkeletonCards count={4} />
      </div>
    );
  }

  if (!isOversight) {
    return (
      <div className="space-y-4">
        <PageHeader title="Domains" />
        <PermissionDenied message="Domain overview is available to oversight roles only." />
      </div>
    );
  }

  const rows = analytics.data?.domains ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Domains"
        subtitle="Cross-domain overview of volunteers, events and completions."
        action={<Button onClick={() => setAdding(true)}>+ Add domain</Button>}
      />

      {adding && <AddDomainModal onClose={() => setAdding(false)} onCreated={() => analytics.refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Domains" value={rows.length} loading={analytics.isLoading} />
        <StatCard label="Volunteers" value={rows.reduce((a, d) => a + d.activeVolunteers, 0)} loading={analytics.isLoading} />
        <StatCard label="Events" value={rows.reduce((a, d) => a + d.events, 0)} loading={analytics.isLoading} />
        <StatCard label="Completions" value={rows.reduce((a, d) => a + d.completions, 0)} loading={analytics.isLoading} />
      </div>

      <DataPanel
        title="All domains"
        isLoading={analytics.isLoading}
        isError={analytics.isError}
        error={analytics.error}
        isEmpty={rows.length === 0}
        emptyTitle="No domains configured"
        onRetry={() => analytics.refetch()}
        rowSkeletonCount={4}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <div key={d.domainId} className="surface-inset space-y-2 p-4">
              <p className="text-sm font-bold text-[color:var(--brand-navy)]">{d.domainName}</p>
              <div className="flex flex-wrap gap-1">
                <Badge>{d.activeVolunteers} volunteers</Badge>
                <Badge>{d.events} events</Badge>
                <Badge tone="accent">{d.upcomingEvents} upcoming</Badge>
                <Badge>{d.completions} completed</Badge>
              </div>
            </div>
          ))}
        </div>
      </DataPanel>
    </div>
  );
}

function AddDomainModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const create = useCreateDomain();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    create.mutate(
      { name, description: description || null },
      {
        onSuccess: (res) => {
          setMessage(res.created ? "Domain created." : "A domain with that name already exists.");
          onCreated();
          if (res.created) setTimeout(onClose, 700);
        },
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not create domain."),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add domain"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={name.trim().length < 2}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Domain name" hint="e.g. Content Writing, Graphic Designing, Video Editing">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="Optional">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {message && <p className="text-xs font-medium text-[color:var(--brand-navy)]">{message}</p>}
        <p className="text-[11px] text-[color:var(--navy-45)]">
          Domains are required before importing volunteers — an import row with an unknown domain is rejected.
        </p>
      </div>
    </Modal>
  );
}
