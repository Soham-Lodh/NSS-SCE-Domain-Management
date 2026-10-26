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

/* ---------------------------------------------------------------
 * Central user-facing date display contract (DD/MM/YYYY).
 *
 * Everywhere in the UI, exports and emails dates render as
 * `DD/MM/YYYY`, date-times as `DD/MM/YYYY HH:mm` (24-hour clock) in
 * the organization timezone (default Asia/Kolkata). Storage/transport
 * remains ISO/UTC instants — never reformat into strings for storage.
 * --------------------------------------------------------------- */

/** The configured organization display timezone. */
export const ORGANIZATION_TIMEZONE = "Asia/Kolkata";
const DISPLAY_LOCALE = "en-GB"; // deterministic dd/mm/yyyy ordering

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTS,
  ...TIME_OPTS,
};

/** `DD/MM/YYYY` in the organization timezone. Invalid input renders as "-". */
export function formatDate(value: Date | string, timeZone: string = ORGANIZATION_TIMEZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...DATE_OPTS, timeZone }).format(date);
}

/** `DD/MM/YYYY HH:mm` (24-hour) in the organization timezone. */
export function formatDateTime(value: Date | string, timeZone: string = ORGANIZATION_TIMEZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  const datePart = new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...DATE_OPTS, timeZone }).format(date);
  // en-GB formats a combined date-time with a comma; compose explicitly.
  const timePart = new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...TIME_OPTS, timeZone }).format(date);
  return `${datePart} ${timePart}`;
}

/**
 * Formats a UTC instant in the organization timezone. Returns a stable,
 * locale-pinned string so server and client render identically.
 * Default matches the org-wide contract: DD/MM/YYYY HH:mm (24h).
 */
export function formatInTimeZone(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = DATETIME_OPTS,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  if (options === DATETIME_OPTS) return formatDateTime(date, timeZone);
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...options, timeZone }).format(date);
}

export function formatDateTimeRange(
  startAt: Date | string,
  endAt: Date | string,
  timeZone: string,
): string {
  return `${formatDateTime(startAt, timeZone)} — ${formatDateTime(endAt, timeZone)}`;
}

export const CATEGORY_LABELS: Record<DerivedEventCategory, string> = {
  UPCOMING: "Upcoming",
  ONGOING: "Ongoing",
  PAST: "Past",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
