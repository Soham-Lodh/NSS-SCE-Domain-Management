import type { AppRole } from "@/lib/auth/types";

/** DTOs returned by the API — the only shapes client code depends on. */

export type PaginatedDTO<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type MeDTO = {
  appUserId: string;
  fullName: string;
  email: string;
  role: AppRole;
  roles: AppRole[];
  domainId: string | null;
  domainIds: string[];
  isActive: boolean;
};

export type DomainDTO = { id: string; name: string; description: string | null };
export type ProjectDTO = { id: string; name: string };

export type VolunteerRowDTO = {
  membershipId: string;
  personId: string;
  fullName: string;
  email: string;
  rollNumber: string | null;
  projectName: string | null;
  isActive: boolean;
  completedCount: number;
  assignedCount: number;
  upcomingCount: number;
};

export type EventCardDTO = {
  id: string;
  domainId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  endedAt: string | null;
  category: "UPCOMING" | "ONGOING" | "PAST" | "COMPLETED" | "CANCELLED";
  assignedCount: number;
  completedCount: number;
};

export type AssignmentDTO = {
  id: string;
  status: "ASSIGNED" | "COMPLETED";
  assignedAt: string;
  completedAt: string | null;
  removedAt?: string | null;
  membership?: { id: string; person: { fullName: string; rollNumberNormalized: string | null } };
  event?: { id: string; title: string; startAt: string; endAt: string; status: string };
};

export type EventDetailDTO = {
  id: string;
  domainId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  domain: { id: string; name: string };
  createdBy: { person: { fullName: string } };
  assignments: AssignmentDTO[];
};

export type VolunteerDetailDTO = {
  id: string;
  isActive: boolean;
  joinedAt: string;
  person: { id: string; fullName: string; emailNormalized: string; rollNumberNormalized: string | null };
  domain: { id: string; name: string };
  project: { id: string; name: string } | null;
  assignments: AssignmentDTO[];
};

export type AnalyticsDTO = {
  domainId: string;
  domainName: string;
  volunteers: number;
  activeVolunteers: number;
  events: number;
  upcomingEvents: number;
  ongoingEvents: number;
  pastEvents: number;
  cancelledEvents: number;
  assignments: number;
  completions: number;
};

export type UserRowDTO = {
  appUserId: string;
  fullName: string;
  email: string;
  role: AppRole;
  domainId: string | null;
  domainName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type EmailDeliveryLogRowDTO = {
  id: string;
  outboxId: string | null;
  recipient: string;
  templateKey: string;
  eventType: string;
  subject: string | null;
  status: "QUEUED" | "SENT" | "FAILED" | "DEAD" | "SUPPRESSED";
  attemptNumber: number;
  eventId: string | null;
  eventTitle: string | null;
  domainId: string | null;
  domainName: string | null;
  assignmentId: string | null;
  monthKey: string | null;
  providerMessageId: string | null;
  reason: string | null;
  createdAt: string;
};

export type AuditRowDTO = {
  id: string;
  createdAt: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  domainId: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  requestId: string | null;
  actor: { id: string; fullName: string; role: AppRole } | null;
};

export type ImportPreviewRowDTO = {
  rowIndex: number;
  email: string;
  fullName: string;
  rollNumber: string;
  year: string;
  gender: string;
  domainName: string;
  projectName: string;
  status: "valid" | "invalid" | "duplicate";
  reason?: string;
};

export type ImportPreviewDTO = {
  rows: ImportPreviewRowDTO[];
  summary: { total: number; valid: number; invalid: number; duplicate: number };
};

export type ImportCommitResultDTO = {
  created: number;
  skipped: number;
  skippedRows: { email: string; reason: string }[];
};

export type PendingPersonDTO = {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  domainId: string | null;
  projectId: string | null;
  domainName: string | null;
  projectName: string | null;
  createdAt: string;
};

export type AddPersonResultDTO = { mode: "role-applied" | "invited"; id: string };

export type BulkAssignSummaryDTO = {
  assigned: number;
  alreadyAssigned: number;
  rejected: number;
  results: { membershipId: string; result: "assigned" | "already_assigned" | "rejected"; reason?: string }[];
};
