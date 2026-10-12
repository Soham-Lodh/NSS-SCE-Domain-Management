"use client";

import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import { Badge } from "@/components/ui/primitives";
import { useMe } from "@/hooks/api-hooks";
import { ROLE_LABELS } from "@/lib/auth/types";

export default function SettingsPage() {
  const me = useMe();

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Your account and session information." />

      <div className="grid gap-4 lg:grid-cols-2">
        <DataPanel
          title="Account"
          isLoading={me.isLoading}
          isError={me.isError}
          error={me.error}
          isEmpty={!me.data}
          onRetry={() => me.refetch()}
        >
          {me.data && (
            <dl className="space-y-2 text-sm">
              <Row label="Name">{me.data.fullName}</Row>
              <Row label="Email">{me.data.email}</Row>
              <Row label="Role"><Badge tone="accent">{ROLE_LABELS[me.data.role]}</Badge></Row>
              <Row label="Domain">{me.data.domainId ? "Assigned" : "—"}</Row>
            </dl>
          )}
        </DataPanel>

        <DataPanel
          title="Security"
          subtitle="How this platform protects your data"
          isLoading={false}
          isError={false}
          error={null}
          isEmpty={false}
        >
          <ul className="space-y-2 text-xs text-[color:var(--navy-70)]">
            <li>• Sessions use secure, HttpOnly cookies. Tokens are never stored in browser storage.</li>
            <li>• Every request is authorized on the server against your current role and domain.</li>
            <li>• Role and domain checks are deny-by-default and re-evaluated on every request.</li>
            <li>• Sensitive actions are recorded in an append-only audit log.</li>
            <li>• You can only read the records your role permits — hidden buttons are never the security boundary.</li>
          </ul>
        </DataPanel>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--navy-06)] pb-2">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]">{label}</dt>
      <dd className="text-sm font-medium text-[color:var(--brand-navy)]">{children}</dd>
    </div>
  );
}
