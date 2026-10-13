"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  exportDomainReport,
  exportVolunteers,
  useCreateVolunteer,
  useDomains,
  useImportCommit,
  useImportVolunteers,
  useMe,
  useVolunteers,
} from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import type { ImportPreviewDTO, ImportPreviewRowDTO } from "@/lib/types/api";

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function VolunteersPage() {
  const me = useMe();
  const domains = useDomains();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));
  const canManage = isOversight;

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("");

  const effectiveDomainId = (me.data?.domainId ?? selectedDomain) || undefined;
  const canLoad = !!effectiveDomainId;
  const waitingForDomainSelection = isOversight && !effectiveDomainId;

  const query = useVolunteers({
    domainId: effectiveDomainId,
    search: debouncedSearch || undefined,
    activeOnly,
    page,
    limit: 25,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeOnly, effectiveDomainId]);

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function runExport(kind: "volunteers" | "report") {
    setExportError(null);
    setExporting(kind);
    try {
      if (kind === "volunteers") await exportVolunteers(effectiveDomainId);
      else await exportDomainReport(effectiveDomainId);
    } catch (err) {
      setExportError(err instanceof ApiClientError ? err.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Volunteer Database"
        subtitle="Sorted by number of completed events (descending), then name."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => runExport("volunteers")}
              loading={exporting === "volunteers"}
              disabled={!canLoad}
            >
              ⬇ Export (Excel)
            </Button>
            {isOversight && (
              <Button
                variant="secondary"
                onClick={() => runExport("report")}
                loading={exporting === "report"}
                disabled={!canLoad}
              >
                ⬇ Domain report
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" onClick={() => setImporting(true)} disabled={!canLoad}>
                ⬆ Import Excel
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setCreating(true)} disabled={!canLoad}>
                + Add volunteer
              </Button>
            )}
          </div>
        }
      />

      {exportError && (
        <p role="alert" className="text-xs font-medium text-[color:var(--brand-red)]">
          {exportError}
        </p>
      )}

      <DataPanel title="Filters" isLoading={me.isLoading} isError={false} error={null} isEmpty={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search">
            <Input
              placeholder="Name, roll number or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          {isOversight && !me.data?.domainId && (
            <Field label="Domain">
              <Select value={selectedDomain} onChange={(e) => setSelectedDomain(e.target.value)}>
                <option value="">Select a domain…</option>
                {domains.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Status">
            <Select value={activeOnly ? "true" : "false"} onChange={(e) => setActiveOnly(e.target.value === "true")}>
              <option value="true">Active only</option>
              <option value="false">All (incl. inactive)</option>
            </Select>
          </Field>
        </div>
      </DataPanel>

      <DataPanel
        title="Members"
        subtitle={query.data ? `${query.data.total} record(s)` : undefined}
        isLoading={me.isLoading || (!!effectiveDomainId && query.isLoading)}
        isError={!waitingForDomainSelection && query.isError}
        error={query.error}
        isEmpty={waitingForDomainSelection || (query.data?.items.length ?? 0) === 0}
        emptyTitle={waitingForDomainSelection ? "Select a domain" : "No members found"}
        emptyDescription={
          waitingForDomainSelection
            ? "Choose a domain above to list its volunteers."
            : "Try changing your search or filters, or import an Excel sheet."
        }
        onRetry={() => query.refetch()}
        rowSkeletonCount={8}
      >
        <TableShell>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Roll no.</Th>
              <Th>Project</Th>
              <Th className="text-right">Completed</Th>
              <Th className="text-right">Assigned</Th>
              <Th className="text-right">Upcoming</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((v) => (
              <tr key={v.membershipId} className="hover:bg-[color:var(--navy-06)]">
                <Td>
                  <span className="font-semibold text-[color:var(--brand-navy)]">{v.fullName}</span>
                  <span className="block text-[11px] text-[color:var(--navy-45)]">{v.email}</span>
                </Td>
                <Td>{v.rollNumber ?? "—"}</Td>
                <Td>{v.projectName ?? "—"}</Td>
                <Td className="text-right font-bold">{v.completedCount}</Td>
                <Td className="text-right">{v.assignedCount}</Td>
                <Td className="text-right">{v.upcomingCount}</Td>
                <Td>
                  <StatusPill label={v.isActive ? "Active" : "Inactive"} tone={v.isActive ? "success" : "neutral"} />
                </Td>
                <Td>
                  <Link href={`/dashboard/volunteers/${v.membershipId}`} className="btn btn-secondary px-3 py-1 text-xs">
                    View more
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        {query.data && query.data.total > query.data.limit && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-[color:var(--navy-45)]">
              Page {query.data.page} · {query.data.total} total
            </span>
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

      {canManage && (
        <CreateVolunteerModal
          open={creating}
          onClose={() => setCreating(false)}
          domains={domains.data ?? []}
          defaultDomainId={me.data?.domainId ?? undefined}
        />
      )}

      {canManage && (
        <ImportModal open={importing} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}

function CreateVolunteerModal({
  open,
  onClose,
  domains,
  defaultDomainId,
}: {
  open: boolean;
  onClose: () => void;
  domains: { id: string; name: string }[];
  defaultDomainId?: string;
}) {
  const create = useCreateVolunteer();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    rollNumber: "",
    domainId: defaultDomainId ?? domains[0]?.id ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!form.domainId && (defaultDomainId || domains[0]?.id)) {
      setForm((current) => ({
        ...current,
        domainId: defaultDomainId ?? domains[0]?.id ?? "",
      }));
    }
  }, [defaultDomainId, domains, form.domainId]);

  function submit() {
    setMessage(null);
    create.mutate(
      {
        fullName: form.fullName,
        email: form.email,
        rollNumber: form.rollNumber || undefined,
        domainId: form.domainId,
      },
      {
        onSuccess: () => {
          setMessage("Volunteer added.");
          setForm({ ...form, fullName: "", email: "", rollNumber: "" });
          setTimeout(onClose, 700);
        },
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not add volunteer."),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add volunteer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!form.fullName || !form.email || !form.domainId}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name">
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Email" hint="Must end with an allowed institutional domain">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Roll number" hint="Optional">
          <Input value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
        </Field>
        <Field label="Domain">
          <Select value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {message && <p className="text-xs font-medium text-[color:var(--brand-navy)]">{message}</p>}
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useImportVolunteers();
  const commit = useImportCommit();
  const [data, setData] = useState<ImportPreviewDTO | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setData(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    preview.mutate(file, {
      onSuccess: (p) => setData(p),
      onError: (err) => setError(err instanceof ApiClientError ? err.message : "Could not read the file."),
    });
  }

  function confirm() {
    if (!data) return;
    const rows = data.rows
      .filter((r) => r.status === "valid")
      .map((r) => ({
        email: r.email,
        fullName: r.fullName,
        rollNumber: r.rollNumber,
        year: r.year,
        gender: r.gender,
        domainName: r.domainName,
        projectName: r.projectName,
      }));
    commit.mutate(rows, {
      onSuccess: (res) => {
        setResult(`Added ${res.created} volunteer(s). Skipped ${res.skipped}.`);
        setData(null);
      },
      onError: (err) => setError(err instanceof ApiClientError ? err.message : "Import failed."),
    });
  }

  const s = data?.summary;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import volunteers from Excel"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Close
          </Button>
          <Button onClick={confirm} loading={commit.isPending} disabled={!data || (s?.valid ?? 0) === 0}>
            Confirm & add {s ? `(${s.valid})` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="surface-inset p-3 text-[11px] text-[color:var(--navy-70)]">
          Expected columns: <strong>Email Address, Name, Roll No, Year, Gender, Domain</strong>.
          Rows with an email outside the allowed domains, an unknown domain or duplicates are
          rejected. Nothing is saved until you confirm the preview below.
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={onFile}
          className="input file:mr-3 file:rounded-lg file:border-0 file:bg-[color:var(--navy-10)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[color:var(--brand-navy)]"
        />

        {preview.isPending && <p className="text-xs text-[color:var(--navy-45)]">Reading spreadsheet…</p>}
        {error && <p className="text-xs font-medium text-[color:var(--brand-red)]">{error}</p>}
        {result && <p className="text-xs font-semibold text-[color:var(--brand-navy)]">{result}</p>}

        {s && (
          <div className="flex flex-wrap gap-2">
            <Badge>{s.total} rows</Badge>
            <Badge tone="success">{s.valid} valid</Badge>
            <Badge tone="danger">{s.invalid} invalid</Badge>
            <Badge tone="accent">{s.duplicate} duplicate</Badge>
          </div>
        )}

        {data && data.rows.length > 0 && (
          <div className="max-h-72 overflow-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th></Th>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Roll</Th>
                  <Th>Domain</Th>
                  <Th>Project</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <PreviewRow key={`${r.rowIndex}-${r.email}`} row={r} />
                ))}
              </tbody>
            </TableShell>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PreviewRow({ row }: { row: ImportPreviewRowDTO }) {
  const tone = row.status === "valid" ? "success" : row.status === "duplicate" ? "accent" : "danger";
  return (
    <tr>
      <Td>
        <span className="font-mono text-[10px] text-[color:var(--navy-45)]">{row.rowIndex}</span>
      </Td>
      <Td>{row.fullName}</Td>
      <Td>{row.email}</Td>
      <Td>{row.rollNumber || "—"}</Td>
      <Td>{row.domainName || "—"}</Td>
      <Td>{row.projectName || "—"}</Td>
      <Td>
        <StatusPill label={row.status} tone={tone} />
        {row.reason && <span className="block text-[10px] text-[color:var(--navy-45)]">{row.reason}</span>}
      </Td>
    </tr>
  );
}
