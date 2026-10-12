/**
 * Event category derivation and timezone display helpers.
 *
 * Timestamps are stored as UTC instants. Upcoming/Ongoing/Past are DERIVED at
 * read time — never persisted. CANCELLED is an explicit lifecycle state.
 */

export type DerivedEventCategory =
  | "UPCOMING"
  | "ONGOING"
  | "PAST"
  | "COMPLETED"
  | "CANCELLED";

export type LifecycleStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";

/**
 * Explicit lifecycle states win over time-derived ones. A task is NEVER ended
 * automatically: PAST simply means the deadline passed and it is still open
 * until a domain lead marks it COMPLETED.
 */
export function deriveEventCategory(
  startAt: Date,
  endAt: Date,
  status: LifecycleStatus,
  now: Date = new Date(),
): DerivedEventCategory {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "COMPLETED") return "COMPLETED";
  if (now < startAt) return "UPCOMING";
  if (now < endAt) return "ONGOING";
  return "PAST";
}

export function isValidEventWindow(startAt: Date, endAt: Date): boolean {
  return endAt.getTime() > startAt.getTime();
}

/**
 * Formats a UTC instant in the organization timezone. Returns a stable,
 * locale-pinned string so server and client render identically.
 */
export function formatInTimeZone(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  },
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone }).format(date);
}

export function formatDateTimeRange(
  startAt: Date | string,
  endAt: Date | string,
  timeZone: string,
): string {
  return `${formatInTimeZone(startAt, timeZone)} — ${formatInTimeZone(endAt, timeZone)}`;
}

export const CATEGORY_LABELS: Record<DerivedEventCategory, string> = {
  UPCOMING: "Upcoming",
  ONGOING: "Ongoing",
  PAST: "Past",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
