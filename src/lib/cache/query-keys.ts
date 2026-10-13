/**
 * Centralized USER-SIDE query cache contract (TanStack Query).
 *
 * The browser query cache is the primary caching layer. Every key is
 * domain- and filter-scoped, and TTLs are short enough to stay fresh while
 * eliminating redundant backend/DB round-trips. Mutations invalidate the exact
 * affected keys via `invalidationKeys` — no dead/stale cache.
 *
 * There is intentionally NO shared/cloud cache: correctness never depends on a
 * remote cache, and authorization is always re-checked on the server.
 */

export const TTL = {
  me: 60_000,
  domains: 5 * 60_000,
  projects: 5 * 60_000,
  users: 20_000,
  volunteers: 20_000,
  volunteerDetail: 20_000,
  events: 20_000,
  eventDetail: 20_000,
  analytics: 30_000,
  auditLogs: 15_000,
} as const;

export type VolunteerFilters = {
  domainId?: string;
  search?: string;
  projectId?: string;
  activeOnly?: boolean;
  sort?: "completed" | "name";
  page?: number;
  limit?: number;
};

export type EventFilters = {
  domainId?: string;
  category?: "UPCOMING" | "ONGOING" | "PAST" | "COMPLETED" | "CANCELLED" | "ALL";
  search?: string;
  page?: number;
  limit?: number;
};

export type AuditFilters = {
  domainId?: string;
  actorAppUserId?: string;
  action?: string;
  outcome?: "SUCCESS" | "DENIED" | "FAILURE";
  page?: number;
  limit?: number;
};

export const qk = {
  me: () => ["me"] as const,
  domains: () => ["domains"] as const,
  projects: () => ["projects"] as const,
  users: (f: Record<string, unknown> = {}) => ["users", f] as const,
  volunteers: (f: VolunteerFilters = {}) => ["volunteers", f] as const,
  volunteer: (id: string) => ["volunteer", id] as const,
  volunteerHistory: (id: string) => ["volunteer", id, "history"] as const,
  events: (f: EventFilters = {}) => ["events", f] as const,
  event: (id: string) => ["event", id] as const,
  analytics: (f: Record<string, unknown> = {}) => ["analytics", f] as const,
  auditLogs: (f: AuditFilters = {}) => ["audit-logs", f] as const,
};

export type MutationKind =
  | "volunteer"
  | "event"
  | "assignment"
  | "completion"
  | "role"
  | "domain";

/**
 * Returns the query-key PREFIXES to invalidate after a mutation. Prefix
 * invalidation refreshes every filter/page variant of the affected list while
 * leaving unrelated caches warm.
 */
export function invalidationKeys(kind: MutationKind): readonly (readonly unknown[])[] {
  switch (kind) {
    case "volunteer":
      return [["volunteers"], ["volunteer"], ["analytics"], ["events"]];
    case "event":
      return [["events"], ["event"], ["analytics"], ["audit-logs"]];
    case "assignment":
      return [["events"], ["event"], ["volunteers"], ["volunteer"], ["analytics"], ["audit-logs"]];
    case "completion":
      return [["events"], ["event"], ["volunteers"], ["volunteer"], ["analytics"], ["audit-logs"]];
    case "role":
      return [["users"], ["me"], ["audit-logs"]];
    case "domain":
      return [["domains"], ["volunteers"], ["events"], ["analytics"]];
    default:
      return [["me"]];
  }
}
