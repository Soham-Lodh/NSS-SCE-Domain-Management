"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  TTL,
  invalidationKeys,
  qk,
  type AuditFilters,
  type EventFilters,
  type MutationKind,
  type VolunteerFilters,
} from "@/lib/cache/query-keys";
import { apiFetch } from "@/lib/http/client";
import { downloadExport, uploadFile } from "@/lib/http/download";
import type {
  AddPersonResultDTO,
  AnalyticsDTO,
  AuditRowDTO,
  BulkAssignSummaryDTO,
  DomainDTO,
  EventCardDTO,
  EventDetailDTO,
  ImportCommitResultDTO,
  ImportPreviewDTO,
  MeDTO,
  PaginatedDTO,
  PendingPersonDTO,
  UserRowDTO,
  VolunteerDetailDTO,
  VolunteerRowDTO,
} from "@/lib/types/api";

/* ------------------------------ Queries ---------------------------------- */

export function useMe() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: () => apiFetch<MeDTO>("/api/me"),
    staleTime: TTL.me,
  });
}

export function useDomains() {
  return useQuery({
    queryKey: qk.domains(),
    queryFn: () => apiFetch<{ domains: DomainDTO[] }>("/api/domains"),
    staleTime: TTL.domains,
    select: (d) => d.domains,
  });
}

export function useVolunteers(filters: VolunteerFilters) {
  const params = new URLSearchParams();
  if (filters.domainId) params.set("domainId", filters.domainId);
  if (filters.search) params.set("search", filters.search);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.activeOnly !== undefined) params.set("activeOnly", String(filters.activeOnly));
  if (filters.sort) params.set("sort", filters.sort);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 25));

  return useQuery({
    queryKey: qk.volunteers(filters),
    queryFn: () => apiFetch<PaginatedDTO<VolunteerRowDTO>>(`/api/volunteers?${params}`),
    staleTime: TTL.volunteers,
    placeholderData: (prev) => prev, // keep prior page while refreshing (no flicker)
  });
}

export function useVolunteerDetail(id: string) {
  return useQuery({
    queryKey: qk.volunteer(id),
    queryFn: () => apiFetch<VolunteerDetailDTO>(`/api/volunteers/${id}`),
    staleTime: TTL.volunteerDetail,
    enabled: !!id,
  });
}

export function useEvents(filters: EventFilters) {
  const params = new URLSearchParams();
  if (filters.domainId) params.set("domainId", filters.domainId);
  params.set("category", filters.category ?? "ALL");
  if (filters.search) params.set("search", filters.search);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 24));

  return useQuery({
    queryKey: qk.events(filters),
    queryFn: () => apiFetch<PaginatedDTO<EventCardDTO>>(`/api/events?${params}`),
    staleTime: TTL.events,
    placeholderData: (prev) => prev,
  });
}

export function useEventDetail(id: string) {
  return useQuery({
    queryKey: qk.event(id),
    queryFn: () => apiFetch<EventDetailDTO>(`/api/events/${id}`),
    staleTime: TTL.eventDetail,
    enabled: !!id,
  });
}

export function useAnalytics(domainId: string | undefined, scope: "domain" | "all" = "domain") {
  const params = new URLSearchParams({ scope });
  if (domainId) params.set("domainId", domainId);
  return useQuery({
    queryKey: qk.analytics({ domainId, scope }),
    queryFn: () => apiFetch<{ domains: AnalyticsDTO[] }>(`/api/analytics/overview?${params}`),
    staleTime: TTL.analytics,
  });
}

export function useAuditLogs(filters: AuditFilters) {
  const params = new URLSearchParams();
  if (filters.domainId) params.set("domainId", filters.domainId);
  if (filters.action) params.set("action", filters.action);
  if (filters.outcome) params.set("outcome", filters.outcome);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 25));

  return useQuery({
    queryKey: qk.auditLogs(filters),
    queryFn: () => apiFetch<PaginatedDTO<AuditRowDTO>>(`/api/audit-logs?${params}`),
    staleTime: TTL.auditLogs,
    placeholderData: (prev) => prev,
  });
}

export function useUsers(filters: { search?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 25));

  return useQuery({
    queryKey: qk.users(filters),
    queryFn: () => apiFetch<PaginatedDTO<UserRowDTO>>(`/api/users?${params}`),
    staleTime: TTL.users,
    placeholderData: (prev) => prev,
  });
}

/* ---------------------------- Invalidation -------------------------------- */

export function invalidate(client: QueryClient, kind: MutationKind) {
  for (const key of invalidationKeys(kind)) {
    void client.invalidateQueries({ queryKey: key as unknown[] });
  }
}

/* ----------------------------- Mutations ---------------------------------- */

export function useCreateVolunteer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ membershipId: string }>("/api/volunteers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(client, "volunteer"),
  });
}

export function useUpdateVolunteer(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ ok: true }>(`/api/volunteers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(client, "volunteer"),
  });
}

export function useCreateEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ id: string }>("/api/events", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => invalidate(client, "event"),
  });
}

export function useUpdateEvent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ ok: true }>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => invalidate(client, "event"),
  });
}

export function useBulkAssign(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipIds: string[]) =>
      apiFetch<BulkAssignSummaryDTO>(`/api/events/${eventId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ membershipIds }),
      }),
    onSuccess: () => invalidate(client, "assignment"),
  });
}

export type AssignmentAction =
  | { action: "complete" }
  | { action: "reopen" }
  | { action: "remove" }
  | { action: "reassign"; targetEventId: string };

export function useAssignmentAction(assignmentId: string, kind: MutationKind = "completion") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignmentAction) =>
      apiFetch<{ ok: true }>(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(client, kind),
  });
}

export function useChangeUserRole(appUserId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { role: string; domainId?: string | null }) =>
      apiFetch<{ ok: true }>(`/api/users/${appUserId}/role`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(client, "role"),
  });
}

/* ------------------- Domains / people / import / lifecycle ---------------- */

export function useCreateDomain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null }) =>
      apiFetch<{ id: string; created: boolean }>("/api/domains", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(client, "domain"),
  });
}

export function usePendingPeople() {
  return useQuery({
    queryKey: ["pending-people"] as const,
    queryFn: () => apiFetch<{ pending: PendingPersonDTO[] }>("/api/admin/people"),
    staleTime: TTL.users,
    select: (d) => d.pending,
  });
}

export function useAddPerson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { fullName: string; email: string; role: string; domainId?: string | null }) =>
      apiFetch<AddPersonResultDTO>("/api/admin/people", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidate(client, "role");
      void client.invalidateQueries({ queryKey: ["pending-people"] });
    },
  });
}

export function useRemovePerson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; kind: "user" | "pending" }) =>
      apiFetch<{ ok: true }>(`/api/admin/people/${body.id}?kind=${body.kind}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate(client, "role");
      void client.invalidateQueries({ queryKey: ["pending-people"] });
    },
  });
}

/** Step 1 — upload + validate (no writes). */
export function useImportVolunteers() {
  return useMutation({
    mutationFn: (file: File) => uploadFile<ImportPreviewDTO>("/api/volunteers/import", file),
  });
}

/** Step 2 — commit confirmed rows. */
export function useImportCommit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      apiFetch<ImportCommitResultDTO>("/api/volunteers/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows }),
      }),
    onSuccess: () => invalidate(client, "volunteer"),
  });
}

/** End / re-open an event. */
export function useEventLifecycle(eventId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: "complete" | "reopen") =>
      apiFetch<{ ok: true }>(`/api/events/${eventId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => invalidate(client, "event"),
  });
}

/* ------------------------------ Exports ---------------------------------- */

export async function exportVolunteers(domainId?: string) {
  const qs = domainId ? `?domainId=${domainId}` : "";
  await downloadExport(`/api/export/volunteers${qs}`, "volunteers.xlsx");
}

export async function exportDomainReport(domainId?: string) {
  const qs = domainId ? `?domainId=${domainId}` : "";
  await downloadExport(`/api/export/domain-report${qs}`, "domain-report.xlsx");
}
