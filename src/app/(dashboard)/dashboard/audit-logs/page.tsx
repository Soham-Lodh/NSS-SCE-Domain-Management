"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Badge,
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
import { useAuditLogs, useMe } from "@/hooks/api-hooks";
import { formatDateTime } from "@/lib/utils/datetime";
import type { AuditRowDTO } from "@/lib/types/api";

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function AuditLogsPage() {
  const me = useMe();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));

  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<"" | "SUCCESS" | "DENIED" | "FAILURE">("");
  const [page, setPage] = useState(1);
  const debouncedAction = useDebounced(action);

  const query = useAuditLogs({
    action: debouncedAction || undefined,
    outcome: outcome || undefined,
    page,
    limit: 25,
  });

  useEffect(() => setPage(1), [debouncedAction, outcome]);

  if (!me.isLoading && !isOversight) {
    return (
      <div className="space-y-4">
        <PageHeader title="Audit Logs" />
        <PermissionDenied message="Audit logs are available to tech team and coordinators only." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of security-relevant and business actions."
      />

      <DataPanel title="Filters" isLoading={me.isLoading} isError={false} error={null} isEmpty={false}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Action contains">
            <Input placeholder="e.g. ASSIGNMENT" value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="">All outcomes</option>
              <option value="SUCCESS">Success</option>
              <option value="DENIED">Denied</option>
              <option value="FAILURE">Failure</option>
            </Select>
          </Field>
        </div>
      </DataPanel>

      <DataPanel
        title="Events"
        subtitle={query.data ? `${query.data.total} record(s)` : undefined}
        isLoading={me.isLoading || query.isLoading}
        isError={query.isError}
        error={query.error}
        isEmpty={(query.data?.items.length ?? 0) === 0}
        emptyTitle="No audit records"
        onRetry={() => query.refetch()}
        rowSkeletonCount={10}
      >
        <TableShell>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Outcome</Th>
              <Th>Request</Th>
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((r) => (
              <AuditRow key={r.id} row={r} />
            ))}
          </tbody>
        </TableShell>

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

function AuditRow({ row }: { row: AuditRowDTO }) {
  const tone = row.outcome === "SUCCESS" ? "success" : row.outcome === "DENIED" ? "danger" : "neutral";
  return (
    <tr>
      <Td>{formatDateTime(row.createdAt)}</Td>
      <Td>{row.actor ? row.actor.fullName : <span className="text-[color:var(--navy-45)]">system</span>}</Td>
      <Td><span className="font-medium text-[color:var(--brand-navy)]">{row.action}</span></Td>
      <Td>
        {row.targetType ? (
          <Badge>
            {row.targetType}
            {row.targetId ? `#${row.targetId.slice(0, 8)}` : ""}
          </Badge>
        ) : (
          "—"
        )}
      </Td>
      <Td><StatusPill label={row.outcome} tone={tone} /></Td>
      <Td><span className="font-mono text-[10px] text-[color:var(--navy-45)]">{row.requestId?.slice(0, 8) ?? "—"}</span></Td>
    </tr>
  );
}
