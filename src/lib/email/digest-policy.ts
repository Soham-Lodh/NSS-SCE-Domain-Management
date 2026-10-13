/**
 * Pure monthly-digest helpers — no server-only / prisma imports so the logic
 * is unit-testable.
 */

/** Calendar month (in the given timezone) for a date, as "YYYY-MM". */
export function monthKeyFor(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM — stable and zero-dependency.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

/** Midnight-in-org-tz start of the month containing `date`. */
export function monthStartInZone(date: Date, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m] = fmt.format(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
}
