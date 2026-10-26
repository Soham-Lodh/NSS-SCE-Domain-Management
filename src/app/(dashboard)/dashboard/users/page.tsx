"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/app-shell";
import { DataPanel } from "@/components/dashboard/data-panel";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PermissionDenied,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  useAddPerson,
  useChangeUserRole,
  useDomains,
  useMe,
  usePendingPeople,
  useProjects,
  useRemovePerson,
  useUsers,
} from "@/hooks/api-hooks";
import { ApiClientError } from "@/lib/http/client";
import type { AppRole } from "@/lib/auth/types";
import type { UserRowDTO } from "@/lib/types/api";

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function UsersPage() {
  const me = useMe();
  const isOversight = !!me.data && (me.data.roles.includes("TECH_TEAM") || me.data.roles.includes("COORDINATOR"));

  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRowDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UserRowDTO | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const query = useUsers({ search: debounced || undefined, page, limit: 25 });
  const pending = usePendingPeople();
  const remove = useRemovePerson();

  useEffect(() => setPage(1), [debounced]);

  if (!me.isLoading && !isOversight) {
    return (
      <div className="space-y-4">
        <PageHeader title="Users & Roles" />
        <PermissionDenied message="User administration is available to tech team and coordinators only." />
      </div>
    );
  }

  function revoke(id: string, kind: "user" | "pending") {
    setPendingError(null);
    remove.mutate(
      { id, kind },
      {
        onError: (err) => setPendingError(err instanceof ApiClientError ? err.message : "Could not remove."),
      },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users & Roles"
        subtitle="Manage coordinators, tech team members and domain leads. Volunteers are managed in the volunteer database."
        action={<Button onClick={() => setAdding(true)}>Add person</Button>}
      />

      {pendingError && (
        <p role="alert" className="text-xs font-medium text-[color:var(--brand-red)]">
          {pendingError}
        </p>
      )}

      <DataPanel title="Search" isLoading={me.isLoading} isError={false} error={null} isEmpty={false}>
        <Field label="Search users">
          <Input placeholder="Name, email or roll number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </DataPanel>

      <DataPanel
        title="Accounts"
        subtitle={query.data ? `${query.data.total} account(s)` : undefined}
        isLoading={me.isLoading || query.isLoading}
        isRefreshing={query.isPlaceholderData || (query.isFetching && !query.isLoading)}
        isError={query.isError}
        error={query.error}
        isEmpty={(query.data?.items.length ?? 0) === 0}
        emptyTitle="No accounts yet"
        emptyDescription="Accounts appear after people are added or sign in."
        onRetry={() => query.refetch()}
        rowSkeletonCount={8}
      >
        <TableShell>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Domain</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((u) => (
              <tr key={u.appUserId}>
                <Td>
                  <span className="font-semibold text-[color:var(--brand-navy)]">{u.fullName}</span>
                </Td>
                <Td>{u.email}</Td>
                <Td>
                  <Badge tone="accent">{u.role}</Badge>
                </Td>
                <Td>{u.domainName ?? "-"}</Td>
                <Td>
                  <StatusPill label={u.isActive ? "Active" : "Inactive"} tone={u.isActive ? "success" : "neutral"} />
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="secondary"
                      className="px-3 py-1 text-xs"
                      disabled={u.appUserId === me.data?.appUserId}
                      onClick={() => setEditing(u)}
                    >
                      Change role
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1 text-xs"
                      loading={remove.isPending && remove.variables?.id === u.appUserId}
                      disabled={u.appUserId === me.data?.appUserId || !u.isActive}
                      onClick={() => setRemoving(u)}
                    >
                      Remove
                    </Button>
                  </div>
                </Td>
              </tr>
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

      <DataPanel
        title="Pending invitations"
        subtitle="Roles granted at the person's first sign-in"
        isLoading={pending.isLoading}
        isError={pending.isError}
        error={pending.error}
        isEmpty={(pending.data?.length ?? 0) === 0}
        emptyTitle="No pending invitations"
        emptyDescription="People you add with a role will appear here until they sign in."
        onRetry={() => pending.refetch()}
        rowSkeletonCount={3}
      >
        <TableShell>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
                <Th>Domain</Th>
                <Th>Project</Th>
                <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {pending.data?.map((p) => (
              <tr key={p.id}>
                <Td>{p.fullName}</Td>
                <Td>{p.email}</Td>
                <Td>
                  <Badge tone="accent">{p.role}</Badge>
                </Td>
                <Td>{p.domainName ?? "-"}</Td>
                <Td>{p.projectName ?? "-"}</Td>
                <Td>
                  <div className="flex justify-end">
                    <Button
                      variant="danger"
                      className="px-3 py-1 text-xs"
                      loading={remove.isPending && remove.variables?.id === p.id}
                      onClick={() => revoke(p.id, "pending")}
                    >
                      Revoke
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </DataPanel>

      {editing && <RoleModal user={editing} onClose={() => setEditing(null)} />}
      {adding && <AddPersonModal onClose={() => setAdding(false)} />}
      {removing && (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title="Remove account?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending && remove.variables?.id === removing.appUserId}
                onClick={() => {
                  revoke(removing.appUserId, "user");
                  setRemoving(null);
                }}
              >
                Confirm removal
              </Button>
            </>
          }
        >
          <p>
            This will deactivate <strong>{removing.fullName}</strong> and revoke their active roles. This action is recorded in the audit log.
          </p>
        </Modal>
      )}
    </div>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const domains = useDomains();
  const projects = useProjects();
  const add = useAddPerson();
  const [form, setForm] = useState<{ fullName: string; email: string; role: AppRole; domainId: string; projectId: string }>({
    fullName: "",
    email: "",
    role: "COORDINATOR",
    domainId: "",
    projectId: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  const needsDomain = form.role === "DOMAIN_LEAD" || form.role === "VOLUNTEER";
  const valid =
    form.fullName.trim().length >= 2 &&
    /.+@.+/.test(form.email) &&
    (!needsDomain || (!!form.domainId && !!form.projectId));

  function submit() {
    setMessage(null);
    add.mutate(
      {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        domainId: needsDomain && form.domainId ? form.domainId : null,
        projectId: needsDomain && form.projectId ? form.projectId : null,
      },
      {
        onSuccess: (res) => {
          setMessage(
            res.mode === "role-applied"
              ? "Role applied to the existing account."
              : "Invitation saved. The role applies at their first sign-in.",
          );
          setTimeout(onClose, 900);
        },
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not add person."),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add person"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name">
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="Email" hint="Must end with the allowed institutional domain">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>
            <option value="DOMAIN_LEAD">Domain Lead</option>
            <option value="TECH_TEAM">Tech Team</option>
            <option value="COORDINATOR">Coordinator</option>
          </Select>
        </Field>
        {needsDomain && (
          <Field label="Domain" hint={form.role === "VOLUNTEER" ? "Assigns the volunteer to this domain" : "Required"}>
            <Select value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
              <option value="">Select a domain</option>
              {domains.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {needsDomain && (
          <Field label="Project" hint="Required">
            <Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">Select a project</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {message && <p className="text-xs font-medium text-[color:var(--brand-navy)]">{message}</p>}
        <p className="text-[11px] text-[color:var(--navy-45)]">
          Tech team can add tech team members; only coordinators can add coordinators. Everything is audited.
        </p>
      </div>
    </Modal>
  );
}

function RoleModal({ user, onClose }: { user: UserRowDTO; onClose: () => void }) {
  const domains = useDomains();
  const projects = useProjects();
  const change = useChangeUserRole(user.appUserId);
  const [role, setRole] = useState<AppRole>(user.role);
  const [domainId, setDomainId] = useState<string>(user.domainId ?? "");
  const [projectId, setProjectId] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    change.mutate(
      {
        role,
        domainId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? domainId : null,
        projectId: role === "DOMAIN_LEAD" || role === "VOLUNTEER" ? projectId : null,
      },
      {
        onSuccess: () => {
          setMessage("Role updated.");
          setTimeout(onClose, 600);
        },
        onError: (err) => setMessage(err instanceof ApiClientError ? err.message : "Could not change role."),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change role | ${user.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={change.isPending}
            disabled={(role === "DOMAIN_LEAD" || role === "VOLUNTEER") && (!domainId || !projectId)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            <option value="DOMAIN_LEAD">Domain Lead</option>
            <option value="TECH_TEAM">Tech Team</option>
            <option value="COORDINATOR">Coordinator</option>
          </Select>
        </Field>
        {(role === "DOMAIN_LEAD" || role === "VOLUNTEER") && (
          <Field label="Domain">
            <Select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              <option value="">Select a domain</option>
              {domains.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(role === "DOMAIN_LEAD" || role === "VOLUNTEER") && (
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select a project</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {message && <p className="text-xs font-medium text-[color:var(--brand-navy)]">{message}</p>}
      </div>
    </Modal>
  );
}
