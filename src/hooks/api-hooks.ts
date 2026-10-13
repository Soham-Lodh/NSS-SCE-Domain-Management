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
import { copyToClipboard, downloadExport, fetchCsvText, uploadFile } from "@/lib/http/download";
import { useFeedback } from "@/components/providers/feedback-provider";
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
  EmailDeliveryLogRowDTO,
  MeDTO,
  PaginatedDTO,
  PendingPersonDTO,
  ProjectDTO,
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

export function useProjects() {
  return useQuery({
    queryKey: qk.projects(),
    queryFn: () => apiFetch<{ projects: ProjectDTO[] }>("/api/projects"),
    staleTime: TTL.projects,
    select: (d) => d.projects,
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
    enabled: !!filters.domainId,
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
    enabled: !!filters.domainId,
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
    enabled: scope === "all" || !!domainId,
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

export type EmailLogFilters = {
  recipient?: string;
  templateKey?: string;
  status?: string;
  page?: number;
  limit?: number;
};

export function useEmailDeliveryLogs(filters: EmailLogFilters) {
  const params = new URLSearchParams();
  if (filters.recipient) params.set("recipient", filters.recipient);
  if (filters.templateKey) params.set("templateKey", filters.templateKey);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 25));

  return useQuery({
    queryKey: qk.emailLogs(filters),
    queryFn: () => apiFetch<PaginatedDTO<EmailDeliveryLogRowDTO>>(`/api/email-logs?${params}`),
    staleTime: TTL.emailLogs,
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

export async function invalidate(client: QueryClient, kind: MutationKind): Promise<void> {
  await Promise.allSettled(
    invalidationKeys(kind).map((key) => client.invalidateQueries({ queryKey: key as unknown[] })),
  );
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ----------------------------- Mutations ---------------------------------- */

export function useCreateVolunteer() {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ membershipId: string }>("/api/volunteers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await invalidate(client, "volunteer");
      feedback.success("Volunteer added and member list refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not add volunteer.")),
  });
}

export function useUpdateVolunteer(id: string) {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ ok: true }>(`/api/volunteers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await invalidate(client, "volunteer");
      feedback.success("Volunteer updated and member list refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update volunteer.")),
  });
}

export function useCreateEvent() {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ id: string }>("/api/events", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await invalidate(client, "event");
      feedback.success("Event created and event list refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not create event.")),
  });
}

export function useUpdateEvent(id: string) {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ ok: true }>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await invalidate(client, "event");
      feedback.success("Event updated and details refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update event.")),
  });
}

export function useBulkAssign(eventId: string) {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (membershipIds: string[]) =>
      apiFetch<BulkAssignSummaryDTO>(`/api/events/${eventId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ membershipIds }),
      }),
    onSuccess: async () => {
      await invalidate(client, "assignment");
      feedback.success("Assignments updated and event details refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update assignments.")),
  });
}

export type AssignmentAction =
  | { action: "complete" }
  | { action: "reopen" }
  | { action: "remove" }
  | { action: "reassign"; targetEventId: string };

export function useAssignmentAction(assignmentId: string, kind: MutationKind = "completion") {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: AssignmentAction) =>
      apiFetch<{ ok: true }>(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async (_data, variables) => {
      await invalidate(client, kind);
      const label = variables.action === "complete" ? "marked complete" : variables.action === "reopen" ? "reopened" : variables.action === "remove" ? "removed" : "reassigned";
      feedback.success(`Assignment ${label} and event details refreshed.`);
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update assignment.")),
  });
}

export function useChangeUserRole(appUserId: string) {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: { role: string; domainId?: string | null; projectId?: string | null }) =>
      apiFetch<{ ok: true }>(`/api/users/${appUserId}/role`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await invalidate(client, "role");
      feedback.success("Role updated and user list refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update role.")),
  });
}

/* ------------------- Domains / people / import / lifecycle ---------------- */

export function useCreateDomain() {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null }) =>
      apiFetch<{ id: string; created: boolean }>("/api/domains", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await invalidate(client, "domain");
      feedback.success("Domain saved and lists refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not create domain.")),
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
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: { fullName: string; email: string; role: string; domainId?: string | null; projectId?: string | null }) =>
      apiFetch<AddPersonResultDTO>("/api/admin/people", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await invalidate(client, "role");
      await invalidate(client, "volunteer");
      await client.invalidateQueries({ queryKey: ["pending-people"] });
      feedback.success("Person saved and access lists refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not add person.")),
  });
}

export function useRemovePerson() {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (body: { id: string; kind: "user" | "pending" }) =>
      apiFetch<{ ok: true }>(`/api/admin/people/${body.id}?kind=${body.kind}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate(client, "role");
      await client.invalidateQueries({ queryKey: ["pending-people"] });
      feedback.success("Person removed and access lists refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not remove person.")),
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
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      apiFetch<ImportCommitResultDTO>("/api/volunteers/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows }),
      }),
    onSuccess: async (result) => {
      await invalidate(client, "volunteer");
      feedback.success(`${result.created} volunteer(s) imported and member list refreshed.`);
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not import volunteers.")),
  });
}

/** End / re-open an event. */
export function useEventLifecycle(eventId: string) {
  const client = useQueryClient();
  const feedback = useFeedback();
  return useMutation({
    mutationFn: (action: "complete" | "reopen") =>
      apiFetch<{ ok: true }>(`/api/events/${eventId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: async (_result, action) => {
      await invalidate(client, "event");
      feedback.success(action === "complete" ? "Event ended and details refreshed." : "Event reopened and details refreshed.");
    },
    onError: (error) => feedback.error(mutationErrorMessage(error, "Could not update event status.")),
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

export type CsvDatasetKind = "members" | "assignments" | "domain-events";

/** Fetch the CSV for a dataset and copy it to the clipboard (user-initiated). */
export async function copyCsvToClipboard(domainId: string | undefined, dataset: CsvDatasetKind): Promise<void> {
  const params = new URLSearchParams({ dataset });
  if (domainId) params.set("domainId", domainId);
  const text = await fetchCsvText(`/api/export/csv?${params}`);
  await copyToClipboard(text);
}
