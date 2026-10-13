import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { escapeHtml, sendEmail, type OutboundEmail } from "@/lib/email/brevo";
import { writeAudit } from "@/lib/audit/write-audit";
import { decideDelivery, type EmailTemplateKey } from "@/lib/email/delivery-policy";

export type { EmailTemplateKey };

type Tx = Prisma.TransactionClient;

const SUBJECTS: Record<EmailTemplateKey, string> = {
  ROLE_ASSIGNED: "Your NSS SCE KIIT role was updated",
  DOMAIN_LEAD_ASSIGNED: "You were assigned as a domain lead",
  EVENT_ASSIGNED: "You have been assigned to an event",
  ASSIGNMENT_REMOVED: "You were removed from an event",
  EVENT_REMINDER_4D: "Reminder: an assigned task is due in 4 days",
  EVENT_REMINDER_24H: "Reminder: an assigned task is due in 24 hours",
  EVENT_REMINDER_1H: "Reminder: an assigned task is due in 1 hour",
  EVENT_COMPLETED: "An event you were assigned to was completed",
  ACCOUNT_DEACTIVATED: "Your NSS SCE KIIT account was deactivated",
};

/** Shared wrapper for all email templates — matches the NSS SCE KIIT brand. */
function emailShell(subject: string, bodyHtml: string, bodyText: string): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F6FB;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FB;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(47,57,118,0.08)">
  <tr><td style="background:#2F3976;padding:24px 32px;text-align:center">
    <h1 style="margin:0;color:#FFFFFF;font-size:20px;font-weight:600">NSS SCE KIIT</h1>
  </td></tr>
  <tr><td style="padding:32px">
    <h2 style="margin:0 0 20px;color:#2F3976;font-size:18px;font-weight:600">${escapeHtml(subject)}</h2>
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:20px 32px;background:#F4F6FB;text-align:center;font-size:12px;color:#6B7280">
    This is an automated notification from NSS SCE KIIT.<br>You do not need to log in — this email is your notification.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { html, text: `${subject}\n\n${bodyText}\n\n— NSS SCE KIIT` };
}

function labelFor(key: string): string {
  const MAP: Record<string, string> = {
    fullName: "Name",
    event: "Event Name",
    deadline: "Deadline (End Date & Time)",
    daysLeft: "Days Remaining",
    hoursLeft: "Hours Remaining",
    domain: "Domain",
    role: "Role",
    description: "Event Description",
    startAt: "Start Date & Time",
    endAt: "Deadline (End Date & Time)",
    location: "Location",
    assignedBy: "Assigned By",
    endedBy: "Ended By",
    completedBy: "Completed By",
  };
  return MAP[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

const DATE_KEYS = new Set(["startAt", "endAt", "deadline"]);

/** Renders timestamps the same way the web app shows them (IST), not raw ISO. */
function formatValue(key: string, value: string): string {
  if (!DATE_KEYS.has(key)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function renderBody(template: EmailTemplateKey, payload: Record<string, unknown>): {
  html: string;
  text: string;
} {
  const subject = SUBJECTS[template] ?? "NSS SCE KIIT notification";
  const fullName = typeof payload.fullName === "string" ? payload.fullName : "Volunteer";

  // Build detail rows (skip internal ID/metadata fields)
  const skipKeys = new Set(["fullName", "eventId", "domainId", "assignmentId", "volunteerMembershipId"]);
  const details = Object.entries(payload)
    .filter(([k, v]) => !skipKeys.has(k) && (typeof v === "string" || typeof v === "number"))
    .map(([k, v]) => ({ label: labelFor(k), value: formatValue(k, String(v)) }));

  const detailRows = details
    .map((d) => `<tr><td style="padding:8px 14px 8px 0;color:#6B7280;font-size:14px;white-space:nowrap;vertical-align:top;font-weight:500">${escapeHtml(d.label)}</td><td style="padding:8px 0;color:#1F2937;font-size:14px">${escapeHtml(d.value)}</td></tr>`)
    .join("");
  const detailText = details.map((d) => `${d.label}: ${d.value}`).join("\n");

  const greeting = `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">Dear ${escapeHtml(fullName)},</p>`;

  let messageHtml = "";
  let messageText = "";

  switch (template) {
    case "EVENT_ASSIGNED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">You have been assigned to an event. Please review the assignment details and deadlines below:</p>`;
      messageText = `Dear ${fullName},\n\nYou have been assigned to an event. Details below:`;
      break;
    case "EVENT_REMINDER_4D":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">This is a reminder that an assigned task is due in <strong>4 days</strong>. Please ensure all preparation and tasks are on track.</p>`;
      messageText = `Dear ${fullName},\n\nReminder: an assigned task is due in 4 days.`;
      break;
    case "EVENT_REMINDER_24H":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">This is an urgent reminder that an assigned task is due in <strong>24 hours</strong>. Please prioritize completion before the deadline.</p>`;
      messageText = `Dear ${fullName},\n\nUrgent reminder: an assigned task is due in 24 hours.`;
      break;
    case "EVENT_REMINDER_1H":
      messageHtml = `${greeting}<p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.6">⚠️ <strong>Final reminder:</strong> an assigned task is due in <strong>1 hour</strong>!</p><p style="margin:0 0 16px;color:#DC2626;font-size:14px;font-weight:600">Please conclude your activities and submit any required work immediately.</p>`;
      messageText = `Dear ${fullName},\n\nFINAL REMINDER: an assigned task is due in 1 hour!`;
      break;
    case "EVENT_COMPLETED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">An event you were assigned to has been marked as <strong>completed</strong> by the domain lead. Thank you for your service!</p>`;
      messageText = `Dear ${fullName},\n\nAn event you were assigned to has been completed. Thank you for your service!`;
      break;
    case "ASSIGNMENT_REMOVED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">You have been removed from an event assignment. No further action is required from you for this event.</p>`;
      messageText = `Dear ${fullName},\n\nYou have been removed from an event assignment.`;
      break;
    case "ROLE_ASSIGNED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">Your role in NSS SCE KIIT has been updated.</p>`;
      messageText = `Dear ${fullName},\n\nYour role has been updated.`;
      break;
    case "DOMAIN_LEAD_ASSIGNED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">You have been assigned as a <strong>Domain Lead</strong>. You can now manage events and assignments for your domain.</p>`;
      messageText = `Dear ${fullName},\n\nYou have been assigned as a Domain Lead.`;
      break;
    case "ACCOUNT_DEACTIVATED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">Your NSS SCE KIIT account has been deactivated. If you believe this is an error, please contact your coordinator.</p>`;
      messageText = `Dear ${fullName},\n\nYour NSS SCE KIIT account has been deactivated.`;
      break;
    default:
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">You have a new notification from NSS SCE KIIT.</p>`;
      messageText = `Dear ${fullName},\n\nYou have a new notification.`;
      break;
  }

  const tableHtml = details.length > 0
    ? `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px 16px;margin:16px 0">
        <table style="width:100%;border-collapse:collapse">
          <tbody>${detailRows}</tbody>
        </table>
       </div>`
    : "";

  const bodyHtml = `${messageHtml}${tableHtml}`;
  const bodyText = `${messageText}\n\n${detailText}`;
  return emailShell(subject, bodyHtml, bodyText);
}

/**
 * Enqueue an email INSIDE the business transaction. Delivery happens after
 * commit, so a failed send can never roll back committed work.
 * Supports optional nextAttemptAt for scheduled/future deliveries (e.g. an
 * assignment notice that must wait until the event's start date & time).
 */
export async function enqueueEmail(
  tx: Tx,
  args: {
    eventType: string;
    templateKey: EmailTemplateKey;
    recipient: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    nextAttemptAt?: Date;
  },
): Promise<void> {
  await tx.emailOutbox.createMany({
    data: [{
      eventType: args.eventType,
      templateKey: args.templateKey,
      recipient: args.recipient,
      payloadJson: args.payload as Prisma.InputJsonValue,
      status: "PENDING",
      nextAttemptAt: args.nextAttemptAt ?? new Date(),
      idempotencyKey: args.idempotencyKey ?? null,
    }],
    skipDuplicates: Boolean(args.idempotencyKey),
  });
}

const MAX_ATTEMPTS = 5;
const CLAIM_LEASE_MS = 15 * 60_000;

type ClaimedOutboxRow = {
  id: string;
  recipient: string;
  templateKey: string;
  eventType: string;
  payloadJson: Prisma.JsonValue;
  attemptCount: number;
  idempotencyKey: string | null;
};

/** Backoff: 1m, 4m, 9m, 16m… capped. */
function backoffMs(attempt: number): number {
  return Math.min(attempt * attempt * 60_000, 60 * 60_000);
}

/**
 * Deliver pending outbox rows. Intended to be called from a scheduled job /
 * cron route. Failures are recorded and retried with backoff — never thrown.
 *
 * Delivery-time policy (see delivery-policy.ts):
 * - If a domain lead completed/ended/cancelled the event, completed the
 *   assignment, or removed the member before delivery: NEVER send (DEAD).
 * - Assignment notices wait until the event's start date & time; reminder
 *   emails wait until their 4d/24h/1h window actually opens.
 * - Every send, suppression and delivery failure is written to audit_log —
 *   visible to both tech team and coordinators.
 */
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number; deferred: number; suppressed: number }> {
  const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
  // Claim rows in one PostgreSQL statement. SKIP LOCKED allows concurrent cron
  // workers to make progress without delivering the same email twice.
  const rows = await prisma.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT id
      FROM email_outbox
      WHERE status = 'PENDING'::"OutboxStatus" AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE email_outbox AS outbox
    SET next_attempt_at = ${leaseUntil}, updated_at = NOW()
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING
      outbox.id,
      outbox.recipient,
      outbox.template_key AS "templateKey",
      outbox.event_type AS "eventType",
      outbox.payload_json AS "payloadJson",
      outbox.attempt_count AS "attemptCount",
      outbox.idempotency_key AS "idempotencyKey"
  `);

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let suppressed = 0;

  for (const row of rows) {
    const template = row.templateKey as EmailTemplateKey;
    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    const domainId = typeof payload.domainId === "string" ? payload.domainId : null;
    const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
    const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId : null;
    const volunteerMembershipId = typeof payload.volunteerMembershipId === "string" ? payload.volunteerMembershipId : null;

    // Resolve live state for the delivery policy. Undefined = payload carries
    // no reference (legacy rows / role notices) and cannot be checked.
    let eventCtx: { status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED"; startAt: Date; endAt: Date } | null | undefined;
    let assignmentCtx: { status: "ASSIGNED" | "COMPLETED"; removedAt: Date | null } | null | undefined;

    if (eventId) {
      eventCtx = await prisma.event.findUnique({
        where: { id: eventId },
        select: { status: true, startAt: true, endAt: true },
      });
    }
    if (assignmentId) {
      assignmentCtx = await prisma.eventAssignment.findUnique({
        where: { id: assignmentId },
        select: { status: true, removedAt: true },
      });
    } else if (eventId && volunteerMembershipId) {
      assignmentCtx = await prisma.eventAssignment.findFirst({
        where: { eventId, volunteerMembershipId },
        select: { status: true, removedAt: true },
      });
    }

    const decision = decideDelivery({
      template,
      now: new Date(),
      event: eventCtx,
      assignment: assignmentCtx,
    });

    if (decision.action === "suppress") {
      await prisma.$transaction(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: "DEAD", lastErrorSummary: `Suppressed: ${decision.reason}` },
        });
        await writeAudit(tx, {
          actorAppUserId: null,
          action: "EMAIL_SUPPRESSED",
          targetType: "EmailOutbox",
          targetId: row.id,
          domainId,
          outcome: "SUCCESS",
          after: {
            reason: decision.reason,
            recipient: row.recipient,
            templateKey: row.templateKey,
            eventType: row.eventType,
          },
        });
      });
      suppressed += 1;
      continue;
    }

    if (decision.action === "defer") {
      // Not a failure: keep the row PENDING and retry once the date arrives.
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { nextAttemptAt: decision.nextAttemptAt },
      });
      deferred += 1;
      continue;
    }

    try {
      const body = renderBody(template, payload);
      const email: OutboundEmail = {
        to: row.recipient,
        subject: SUBJECTS[template] ?? "NSS SCE KIIT notification",
        ...body,
      };
      await sendEmail(email);

      // Durable audit logging for every email sent — accessible to both tech team and coordinator.
      await prisma.$transaction(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: "SENT", sentAt: new Date(), attemptCount: { increment: 1 } },
        });
        await writeAudit(tx, {
          actorAppUserId: null,
          action: "EMAIL_SENT",
          targetType: "EmailOutbox",
          targetId: row.id,
          domainId,
          outcome: "SUCCESS",
          after: {
            recipient: row.recipient,
            templateKey: row.templateKey,
            eventType: row.eventType,
            subject: email.subject,
            event: typeof payload.event === "string" ? payload.event : undefined,
          },
        });
      });
      sent += 1;
    } catch (err) {
      const attempt = row.attemptCount + 1;
      const dead = attempt >= MAX_ATTEMPTS;
      const errorMsg = (err instanceof Error ? err.message : "unknown").slice(0, 300);

      await prisma.$transaction(async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? "DEAD" : "PENDING",
            attemptCount: attempt,
            nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
            lastErrorSummary: errorMsg,
          },
        });
        if (dead) {
          await writeAudit(tx, {
            actorAppUserId: null,
            action: "EMAIL_DELIVERY_FAILED",
            targetType: "EmailOutbox",
            targetId: row.id,
            domainId,
            outcome: "FAILURE",
            after: {
              recipient: row.recipient,
              templateKey: row.templateKey,
              eventType: row.eventType,
              attemptCount: attempt,
              error: errorMsg,
            },
          });
        }
      });
      failed += 1;
      logger.warn("outbox_send_failed", { id: row.id, attempt, dead });
    }
  }

  return { sent, failed, deferred, suppressed };
}
