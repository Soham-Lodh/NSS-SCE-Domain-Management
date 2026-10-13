
/**
 * Pure delivery policy for the transactional email outbox.
 *
 * Decides, at delivery time, whether a queued email may still be sent:
 *   - send    → deliver now
 *   - defer   → keep PENDING, retry when a date/time condition is met
 *   - suppress→ mark DEAD, never deliver (audit records the reason)
 *
 * Business rules enforced here:
 * - Assignment notices go out only once the event's start date & time arrived.
 * - Deadline reminders (4 days / 24 hours / 1 hour) go out only inside their
 *   window before the deadline, only while the event is still SCHEDULED and
 *   only to members whose assignment is still active.
 * - If a domain lead completed/ended/cancelled the event, completed the
 *   assignment, or removed the member before delivery, the email is NEVER sent.
 *
 * No imports from server-only / prisma / db — this module is unit-testable.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const REMINDER_WINDOWS: Partial<Record<string, number>> = {
  EVENT_REMINDER_4D: 4 * DAY,
  EVENT_REMINDER_24H: DAY,
  EVENT_REMINDER_1H: HOUR,
};


export type EmailTemplateKey =
  | "ROLE_ASSIGNED"
  | "DOMAIN_LEAD_ASSIGNED"
  | "EVENT_ASSIGNED"
  | "ASSIGNMENT_REMOVED"
  | "EVENT_REMINDER_4D"
  | "EVENT_REMINDER_24H"
  | "EVENT_REMINDER_1H"
  | "EVENT_COMPLETED"
  | "ACCOUNT_DEACTIVATED"
  | "MONTHLY_DIGEST";

export type DeliveryContext = {
  template: EmailTemplateKey;
  now: Date;
  /**
   * `undefined` → payload carries no event reference (legacy row): state cannot
   * be verified, so legacy behaviour (send) is preserved.
   * `null`     → reference present but the row is gone: suppress.
   */
  event?: { status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED"; startAt: Date; endAt: Date } | null;
  assignment?: { status: "ASSIGNED" | "COMPLETED"; removedAt: Date | null } | null;
};

export type DeliveryDecision =
  | { action: "send" }
  | { action: "defer"; nextAttemptAt: Date; reason: string }
  | { action: "suppress"; reason: string };

function suppress(reason: string): DeliveryDecision {
  return { action: "suppress", reason };
}


function statusReason(status: string): string {
  return `Event is no longer SCHEDULED (${status}) — completed, ended or cancelled by a lead.`;
}


export function decideDelivery(ctx: DeliveryContext): DeliveryDecision {
  const { template, now, event, assignment } = ctx;
  const reminderWindow = REMINDER_WINDOWS[template];
  if (event === null) return suppress("The event no longer exists.");


  // ---- Assignment notice: delivered immediately after the assignment commits. ----
  if (template === "EVENT_ASSIGNED") {
    if (assignment === null) return suppress("The assignment no longer exists.");
    if (assignment !== undefined && assignment.removedAt !== null) {
      // A removed assignment may still have a pending ASSIGNMENT_REMOVED
      // notice, but the assignment notice itself is dead at this point.
      return suppress("The member was removed from the event before delivery.");
    }
    if (event !== undefined) {
      if (event.status !== "SCHEDULED") return suppress(statusReason(event.status));
    }
    return { action: "send" };
  }

  // ---- Deadline reminders: strictly inside their window, strictly pre-deadline ----
  if (reminderWindow !== undefined) {
    if (assignment === null) return suppress("The assignment no longer exists.");
    if (assignment !== undefined && assignment.removedAt !== null) {
      return suppress("The member was removed from the event before delivery.");
    }
    if (assignment !== undefined && assignment.status !== "ASSIGNED") {
      return suppress("The assignment was completed before delivery.");
    }
    if (event !== undefined) {
      if (event.status !== "SCHEDULED") return suppress(statusReason(event.status));
      if (now.getTime() >= event.endAt.getTime()) {
        return suppress("The deadline already passed before delivery.");
      }
      const windowStart = event.endAt.getTime() - reminderWindow;
      if (now.getTime() < windowStart) {
        return {
          action: "defer",
          nextAttemptAt: new Date(windowStart),
          reason: "The deadline is outside this reminder's window.",
        };
      }
    }
    return { action: "send" };
  }

  // ---- Completion notice: event status is irrelevant (this email reports it),
  // but a member removed after enqueueing must not receive it. ----
  if (template === "EVENT_COMPLETED") {
    if (assignment === null) return suppress("The assignment no longer exists.");
    if (assignment !== undefined && assignment.removedAt !== null) {
      return suppress("The member was removed from the event before delivery.");
    }
    return { action: "send" };
  }

  // ---- Removal notice: must reach the member even if the event closed later. ----
  if (template === "ASSIGNMENT_REMOVED") {
    if (assignment === null) return suppress("The assignment no longer exists.");
    return { action: "send" };
  }

  // ---- Account / role notices: no event linkage. ----
  return { action: "send" };
}
