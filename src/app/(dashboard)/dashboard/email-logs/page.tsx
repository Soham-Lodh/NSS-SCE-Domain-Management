"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Button,
  Field,
  Input,
  PermissionDenied,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useEmailDeliveryLogs, useMe } from "@/hooks/api-hooks";
import type { EmailDeliveryLogRowDTO } from "@/lib/types/api";

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const STATUS_TONE: Record<string, "success" | "danger" | "accent" | "neutral"> = {
  SENT: "success",
  FAILED: "danger",
  DEAD: "danger",
  QUEUED: "accent",
  SUPPRESSED: "neutral",
};

export default function EmailLogsPage() {
  const me = useMe();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));

  const [recipient, setRecipient] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [status, setStatus] = useState<"" | EmailDeliveryLogRowDTO["status"]>("");
  const [page, setPage] = useState(1);
  const debouncedRecipient = useDebounced(recipient);

  const query = useEmailDeliveryLogs({
    recipient: debouncedRecipient || undefined,
    templateKey: templateKey || undefined,
    status: status || undefined,
    page,
    limit: 25,
  });

  useEffect(() => setPage(1), [debouncedRecipient, templateKey, status]);

  if (!me.isLoading && !isOversight) {
    return (
      <div className="space-y-4">
        <PageHeader title="Email Delivery Logs" />
        <PermissionDenied message="Email delivery logs are available to tech team and coordinators only." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email Delivery Logs"
        subtitle="Every queued, sent, failed, suppressed and dead-letter email — append-only."
      />

      <DataPanel title="Filters" isLoading={me.isLoading} isError={false} error={null} isEmpty={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Recipient contains">
            <Input
              placeholder="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              type="search"
            />
          </Field>
          <Field label="Type">
            <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
              <option value="">All types</option>
              <option value="EVENT_ASSIGNED">Task assigned</option>
              <option value="EVENT_REMINDER_4D">Reminder — 4 days</option>
              <option value="EVENT_REMINDER_24H">Reminder — 24 hours</option>
              <option value="EVENT_REMINDER_1H">Reminder — 1 hour</option>
              <option value="MONTHLY_DIGEST">Monthly digest</option>
              <option value="ASSIGNMENT_REMOVED">Removed from event</option>
              <option value="EVENT_COMPLETED">Event completed</option>
              <option value="ROLE_ASSIGNED">Role assigned</option>
              <option value="DOMAIN_LEAD_ASSIGNED">Domain lead assigned</option>
              <option value="ACCOUNT_DEACTIVATED">Account deactivated</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">All statuses</option>
              <option value="QUEUED">Queued</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed (retrying)</option>
              <option value="DEAD">Dead (exhausted)</option>
              <option value="SUPPRESSED">Suppressed</option>
            </Select>
          </Field>
        </div>
      </DataPanel>

      <DataPanel
        title="Deliveries"
        subtitle={query.data ? `${query.data.total} record(s)` : undefined}
        isLoading={me.isLoading || query.isLoading}
        isError={query.isError}
        error={query.error}
        isEmpty={(query.data?.items.length ?? 0) === 0}
        emptyTitle="No delivery records"
        emptyDescription="Emails will appear here as soon as they are queued or delivered."
        onRetry={() => query.refetch()}
        rowSkeletonCount={10}
      >
        {/* Mobile: card list; Desktop: table. */}
        <div className="space-y-2 md:hidden">
          {query.data?.items.map((r) => (
            <div key={r.id} className="surface-inset rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-[color:var(--brand-navy)]">{r.recipient}</span>
                <StatusPill label={r.status} tone={STATUS_TONE[r.status] ?? "neutral"} />
              </div>
              <p className="mt-1 text-[11px] text-[color:var(--navy-70)]">
                {r.templateKey}
                {r.eventTitle ? ` · ${r.eventTitle}` : ""}
                {r.domainName ? ` · ${r.domainName}` : ""}
              </p>
              <p className="mt-0.5 text-[11px] text-[color:var(--navy-45)]">
                {new Date(r.createdAt).toLocaleString()} · attempt {r.attemptNumber}
              </p>
              {r.reason && <p className="mt-1 break-words text-[11px] text-[color:var(--brand-red)]">{r.reason}</p>}
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <TableShell>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Recipient</Th>
                <Th>Type</Th>
                <Th>Task / Domain</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempt</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-[color:var(--navy-06)]">
                  <Td>{new Date(r.createdAt).toLocaleString()}</Td>
                  <Td><span className="font-medium">{r.recipient}</span></Td>
                  <Td><span className="font-mono text-[11px]">{r.templateKey}</span></Td>
                  <Td>
                    {r.eventTitle ?? "—"}
                    {r.domainName && (
                      <span className="block text-[11px] text-[color:var(--navy-45)]">{r.domainName}</span>
                    )}
                  </Td>
                  <Td><StatusPill label={r.status} tone={STATUS_TONE[r.status] ?? "neutral"} /></Td>
                  <Td className="text-right">{r.attemptNumber}</Td>
                  <Td><span className="text-[11px]">{r.reason ?? "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>

        {query.data && query.data.total > query.data.limit && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-[color:var(--navy-45)]">Page {query.data.page}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={!query.data.hasMore} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </DataPanel>
    </div>
  );
}
