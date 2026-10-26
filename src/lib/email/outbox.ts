import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { escapeHtml, sendEmail, type OutboundEmail } from "@/lib/email/brevo";
import { writeAudit } from "@/lib/audit/write-audit";
import { decideDelivery, type EmailTemplateKey } from "@/lib/email/delivery-policy";

import { serverEnv } from "@/lib/env";
import { monthKeyFor } from "@/services/monthly-digest-service";

export type { EmailTemplateKey };

/** Attempt-indexed monthKey for digest log rows (org tz). */
function digestMonthKey(): string | null {
  try {
    return monthKeyFor(new Date(), serverEnv().ORGANIZATION_TIMEZONE);
  } catch {
    return null;
  }
}

/** One append-only row per delivery attempt outcome, for the email logs page. */
async function writeDeliveryLog(tx: Prisma.TransactionClient, args: {
  outboxId: string;
  recipient: string;
  templateKey: string;
  eventType: string;
  subject: string | null;
  status: "QUEUED" | "SENT" | "FAILED" | "DEAD" | "SUPPRESSED";
  attemptNumber: number;
  eventId: string | null;
  domainId: string | null;
  assignmentId: string | null;
  providerMessageId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const monthKey = args.templateKey === "MONTHLY_DIGEST" ? digestMonthKey() : null;
  try {
    await tx.emailDeliveryLog.create({
      data: {
        outboxId: args.outboxId,
        recipient: args.recipient,
        templateKey: args.templateKey,
        eventType: args.eventType,
        subject: args.subject,
        status: args.status,
        attemptNumber: args.attemptNumber,
        eventId: args.eventId,
        domainId: args.domainId,
        assignmentId: args.assignmentId,
        monthKey,
        providerMessageId: args.providerMessageId ?? null,
        reason: args.reason ? args.reason.slice(0, 500) : null,
      },
    });
  } catch (err) {
    // Log-table failure must never block delivery bookkeeping entirely,
    // but is observable here in operational logs.
    logger.warn("email_delivery_log_write_failed", {
      outboxId: args.outboxId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}

type Tx = Prisma.TransactionClient;

const SUBJECTS: Record<EmailTemplateKey, string> = {
  ROLE_ASSIGNED: "Your NSS SCE KIIT role was updated",
  DOMAIN_LEAD_ASSIGNED: "You were assigned as a domain lead",
  EVENT_ASSIGNED: "You have been assigned to an event",
  EVENT_STARTED: "Your assigned task's scheduled time has arrived",
  ASSIGNMENT_REMOVED: "You were removed from an event",
  EVENT_REMINDER_4D: "Reminder: an assigned task is due in 4 days",
  EVENT_REMINDER_24H: "Reminder: an assigned task is due in 24 hours",
  EVENT_REMINDER_1H: "Reminder: an assigned task is due in 1 hour",
  EVENT_COMPLETED: "An event you were assigned to was completed",
  ACCOUNT_DEACTIVATED: "Your NSS SCE KIIT account was deactivated",
  MONTHLY_DIGEST: "Your open tasks this month (NSS SCE KIIT)",
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
  return { html, text: `${subject}\n\n${bodyText}\n\nNSS SCE KIIT` };
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
    taskCount: "Open Tasks",
  };
  return MAP[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

const DATE_KEYS = new Set(["startAt", "endAt", "deadline"]);

/** Renders timestamps the same way the web app shows them (IST), not raw ISO. */
function formatValue(key: string, value: string): string {
  if (!DATE_KEYS.has(key)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function renderBody(template: EmailTemplateKey, payload: Record<string, unknown>): {
  html: string;
  text: string;
} {
  const subject = SUBJECTS[template] ?? "NSS SCE KIIT notification";
  const fullName = typeof payload.fullName === "string" ? payload.fullName : "Volunteer";

  // Build detail rows (skip internal ID/metadata fields and digest arrays)
  const skipKeys = new Set([
    "fullName", "eventId", "domainId", "assignmentId", "volunteerMembershipId", "monthKey", "events", "links",
  ]);
  const details = Object.entries(payload)
    .filter(([k, v]) => !skipKeys.has(k) && (typeof v === "string" || typeof v === "number"))
    .map(([k, v]) => ({ label: labelFor(k), value: formatValue(k, String(v)) }));

  const detailRows = details
    .map((d) => `<tr><td style="padding:8px 14px 8px 0;color:#6B7280;font-size:14px;white-space:nowrap;vertical-align:top;font-weight:500">${escapeHtml(d.label)}</td><td style="padding:8px 0;color:#1F2937;font-size:14px">${escapeHtml(d.value)}</td></tr>`)
    .join("");
  const detailText = details.map((d) => `${d.label}: ${d.value}`).join("\n");
  const links = Array.isArray(payload.links) ? payload.links.filter((link): link is { name: string; url: string } => !!link && typeof link === "object" && typeof (link as { name?: unknown }).name === "string" && typeof (link as { url?: unknown }).url === "string") : [];
  const linksHtml = links.length ? `<div style="margin:16px 0"><p style="font-weight:600;color:#1F2937">Event links</p><ul>${links.map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.name)}</a></li>`).join("")}</ul></div>` : "";
  const linksText = links.length ? `\n\nEvent links:\n${links.map((link) => `- ${link.name}: ${link.url}`).join("\n")}` : "";

  const greeting = `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">Dear ${escapeHtml(fullName)},</p>`;

  let messageHtml = "";
  let messageText = "";

  switch (template) {
    case "EVENT_ASSIGNED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">You have been assigned to an event. Please review the assignment details and deadlines below:</p>`;
      messageText = `Dear ${fullName},\n\nYou have been assigned to an event. Details below:`;
      break;
    case "EVENT_STARTED":
      messageHtml = `${greeting}<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">The scheduled <strong>start time</strong> for your assigned task has arrived. Please begin working now.</p>`;
      messageText = `Dear ${fullName},\n\nThe scheduled start time for your assigned task has arrived. Please begin working now.`;
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
      messageHtml = `${greeting}<p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.6"><strong>Final reminder:</strong> an assigned task is due in <strong>1 hour</strong>.</p><p style="margin:0 0 16px;color:#DC2626;font-size:14px;font-weight:600">Please conclude your activities and submit any required work immediately.</p>`;
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
    case "MONTHLY_DIGEST": {
      const tasks = Array.isArray(payload.events) ? (payload.events as Array<Record<string, unknown>>) : [];
      const taskItemHtml = tasks.map((t) => {
        const title = typeof t.event === "string" ? t.event : "Untitled task";
        const domain = typeof t.domain === "string" ? t.domain : "";
        const deadline = typeof t.deadline === "string" ? t.deadline : "";
        return `<li style="margin:0 0 10px"><span style="color:#1F2937;font-size:14px;font-weight:600">${escapeHtml(title)}</span>${domain ? `<br><span style="color:#6B7280;font-size:12px">Domain: ${escapeHtml(domain)}</span>` : ""}${deadline ? `<br><span style="color:#6B7280;font-size:12px">Deadline: ${escapeHtml(formatValue("deadline", deadline))}</span>` : ""}</li>`;
      }).join("");
      const taskItemText = tasks.map((t) => {
        const title = typeof t.event === "string" ? t.event : "Untitled task";
        const domain = typeof t.domain === "string" ? ` (${t.domain})` : "";
        const deadline = typeof t.deadline === "string" ? ` — due ${formatValue("deadline", t.deadline)}` : "";
        return `- ${title}${domain}${deadline}`;
      }).join("\n");
      messageHtml = `${greeting}<p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6">You have <strong>${tasks.length}</strong> open task${tasks.length === 1 ? "" : "s"} expected of you this month:</p><ul style="margin:0 0 16px;padding-left:20px">${taskItemHtml}</ul><p style="margin:0;color:#6B7280;font-size:13px">Reach out to your domain lead if anything above is unclear.</p>`;
      messageText = `Dear ${fullName},\n\nYou have ${tasks.length} open task(s) expected of you this month:\n\n${taskItemText}\n\nReach out to your domain lead if anything above is unclear.`;
      break;
    }
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

  const bodyHtml = `${messageHtml}${tableHtml}${linksHtml}`;
  const bodyText = `${messageText}\n\n${detailText}${linksText}`;
  return emailShell(subject, bodyHtml, bodyText);
}

/**
 * Enqueue an email INSIDE the business transaction. Delivery happens after
 * commit, so a failed send can never roll back committed work.
 * Optional `nextAttemptAt` schedules the first eligible attempt (e.g. an
 * EVENT_STARTED notice that must wait for the event's `startAt`).
 *
 * Returns `true` when a NEW outbox row was created. A duplicate idempotency
 * key is an expected idempotent no-op (returns false — no business failure,
 * and no misleading QUEUED delivery-log row).
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
): Promise<boolean> {
  try {
    const eventId = typeof args.payload.eventId === "string" ? args.payload.eventId : null;
    const payload = eventId
      ? {
          ...args.payload,
          links: await tx.eventLink.findMany({
            where: { eventId },
            select: { name: true, url: true },
            orderBy: { createdAt: "asc" },
          }),
        }
      : args.payload;
    const created = await tx.emailOutbox.create({
      data: {
        eventType: args.eventType,
        templateKey: args.templateKey,
        recipient: args.recipient,
        payloadJson: payload as Prisma.InputJsonValue,
        status: "PENDING",
        nextAttemptAt: args.nextAttemptAt ?? new Date(),
        idempotencyKey: args.idempotencyKey ?? null,
        eventId,
        assignmentId: typeof payload.assignmentId === "string" ? payload.assignmentId : null,
      },
      select: { id: true },
    });

    // Queued ≠ delivered: the QUEUED row in the email delivery log records the
    // enqueue event only. It is linked to its outbox row so the logs view can
    // aggregate one effective status per logical email (history is preserved).
    try {
      await tx.emailDeliveryLog.create({
        data: {
          outboxId: created.id,
          recipient: args.recipient,
          templateKey: args.templateKey,
          eventType: args.eventType,
          subject: SUBJECTS[args.templateKey] ?? null,
          status: "QUEUED",
          attemptNumber: 0,
          eventId,
          domainId: typeof payload.domainId === "string" ? payload.domainId : null,
          assignmentId: typeof payload.assignmentId === "string" ? payload.assignmentId : null,
          monthKey: typeof payload.monthKey === "string" ? payload.monthKey : null,
        },
      });
    } catch {
      // Non-fatal: delivery-outcome rows will still be written by the worker.
    }
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Duplicate idempotency key — expected on retried/concurrent mutations.
      return false;
    }
    throw err;
  }
}

/**
 * Atomically suppress every still-pending outbox message belonging to an
 * assignment and/or event — called inside the SAME business transaction that
 * removes/completes an assignment or closes an event. The member then receives
 * no queued assignment/start/reminder email about that task.
 *
 * Bounded (≤200 rows per call) and audit-logged; SUPPRESSED delivery-log rows
 * are written here so the logs view shows the final state immediately even if
 * the worker never observes the row again.
 */
export async function suppressOutboxFor(
  tx: Tx,
  args: { assignmentId?: string; eventId?: string; reason: string },
): Promise<number> {
  if (!args.assignmentId && !args.eventId) return 0;
  const pending = await tx.emailOutbox.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      ...(args.assignmentId ? { assignmentId: args.assignmentId } : {}),
      ...(args.eventId ? { eventId: args.eventId } : {}),
    },
    select: {
      id: true, eventType: true, templateKey: true, recipient: true,
      attemptCount: true, eventId: true, assignmentId: true,
    },
    orderBy: { id: "asc" },
    take: 200,
  });
  if (pending.length === 0) return 0;

  await tx.emailOutbox.updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: { status: "DEAD", lastErrorSummary: `Suppressed: ${args.reason}` },
  });

  await tx.emailDeliveryLog.createMany({
    data: pending.map((r) => ({
      outboxId: r.id,
      recipient: r.recipient,
      templateKey: r.templateKey,
      eventType: r.eventType,
      subject: SUBJECTS[r.templateKey as EmailTemplateKey] ?? null,
      status: "SUPPRESSED" as const,
      attemptNumber: r.attemptCount,
      eventId: r.eventId,
      assignmentId: r.assignmentId,
      reason: args.reason.slice(0, 500),
    })),
  });
  return pending.length;
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
 * Claiming: rows are claimed atomically in ONE statement with
 * FOR UPDATE SKIP LOCKED and an explicit leasable PROCESSING state — parallel
 * workers never claim the same row, and a worker that crashed mid-send has its
 * lease expire so the row becomes eligible again (bounded retry, no infinite
 * loop: MAX_ATTEMPTS + exponential backoff).
 *
 * Delivery-time policy (see delivery-policy.ts), re-checked against LIVE event
 * and assignment state immediately before sending:
 * - Start-notice (EVENT_STARTED) waits for the live event `startAt`.
 * - Reminder emails wait until their 4d/24h/1h window actually opens.
 * - If a lead completed/ended/cancelled the event, completed the assignment,
 *   or removed the member before delivery: NEVER send (DEAD).
 * - Every send, suppression and delivery failure is written to audit_log.
 *
 * Known ambiguity (documented): SMTP cannot offer mathematically strict
 * exactly-once delivery — if the provider accepts a message and the worker
 * crashes before persisting SENT, the lease expiry re-sends it.
 */
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number; deferred: number; suppressed: number }> {
  const leaseMs = `${Math.floor(CLAIM_LEASE_MS / 60_000)} minutes`;
  // Claim rows in one PostgreSQL statement. Stale expired leases (a crashed
  // worker's PROCESSING row) become re-claimable here; SKIP LOCKED lets
  // concurrent cron workers make progress.
  const rows = await prisma.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT id
      FROM email_outbox
      WHERE
        (status = 'PENDING'::"OutboxStatus" AND next_attempt_at <= NOW())
        OR (status = 'PROCESSING'::"OutboxStatus" AND claimed_at <= NOW() - ${leaseMs}::interval)
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE email_outbox AS outbox
    SET status = 'PROCESSING'::"OutboxStatus", claimed_at = NOW(), updated_at = NOW()
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
    let payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    const domainId = typeof payload.domainId === "string" ? payload.domainId : null;
    const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
    const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId : null;
    const volunteerMembershipId = typeof payload.volunteerMembershipId === "string" ? payload.volunteerMembershipId : null;

    // Resolve live state for the delivery policy. Undefined = payload carries
    // no reference (legacy rows / role notices) and cannot be checked.
    let eventCtx: { status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "ARCHIVED"; startAt: Date; endAt: Date } | null | undefined;
    let assignmentCtx: { status: "ASSIGNED" | "COMPLETED"; removedAt: Date | null } | null | undefined;

    if (eventId) {
      const links = await prisma.eventLink.findMany({ where: { eventId }, select: { name: true, url: true }, orderBy: { createdAt: "asc" } });
      payload = { ...payload, links };
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

    // Re-claim the row before ANY terminal update: another transaction (e.g. a
    // business suppression) may have taken the row out of PROCESSING while we
    // were checking state or waiting on SMTP. Conditional updates (`WHERE
    // status = 'PROCESSING'`) are the worker side of that contract.
    const claim = await prisma.emailOutbox.updateMany({
      where: { id: row.id, status: "PROCESSING", claimedAt: { not: null } },
      data: { claimedAt: new Date() },
    });
    if (claim.count === 0) {
      // Lost the row (suppressed/raced) — leave decision bookkeeping to whoever
      // took it, do not send.
      continue;
    }

    if (decision.action === "suppress") {
      const applied = await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING" },
        data: { status: "DEAD", lastErrorSummary: `Suppressed: ${decision.reason}` },
      });
      if (applied.count > 0) {
        await prisma.$transaction(async (tx) => {
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
          await writeDeliveryLog(tx, {
            outboxId: row.id,
            recipient: row.recipient,
            templateKey: row.templateKey,
            eventType: row.eventType,
            subject: SUBJECTS[template] ?? null,
            status: "SUPPRESSED",
            attemptNumber: row.attemptCount,
            eventId,
            domainId,
            assignmentId,
            reason: decision.reason,
          });
        });
      }
      suppressed += 1;
      continue;
    }

    if (decision.action === "defer") {
      // Not a failure: return the row to PENDING so it can be suppressed by a
      // business transaction in the meantime; retry once the date arrives.
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING" },
        data: { status: "PENDING", nextAttemptAt: decision.nextAttemptAt, claimedAt: null },
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

      // Conditional terminal transition: if a suppression raced us between the
      // SMTP send and this update, do not write a misleading SENT record.
      const applied = await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING" },
        data: { status: "SENT", sentAt: new Date(), attemptCount: { increment: 1 }, claimedAt: null },
      });

      
      if (applied.count > 0) {
        await prisma.$transaction(async (tx) => {
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
          await writeDeliveryLog(tx, {
            outboxId: row.id,
            recipient: row.recipient,
            templateKey: row.templateKey,
            eventType: row.eventType,
            subject: email.subject,
            status: "SENT",
            attemptNumber: row.attemptCount + 1,
            eventId,
            domainId,
            assignmentId,
            reason: null,
          });
        });
      }
      sent += 1;
    } catch (err) {
      const attempt = row.attemptCount + 1;
      const dead = attempt >= MAX_ATTEMPTS;
      const errorMsg = (err instanceof Error ? err.message : "unknown").slice(0, 300);

      // If the row left PROCESSING (suppressed concurrently) before we could
      // record the failure, a failed send outcome is moot — skip bookkeeping.
      const applied = await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: "PROCESSING" },
        data: {
          status: dead ? "DEAD" : "PENDING",
          attemptCount: attempt,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
          lastErrorSummary: errorMsg,
          ...(dead ? {} : { claimedAt: null }),
        },
      });

      if (applied.count > 0) {
        await prisma.$transaction(async (tx) => {
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
          await writeDeliveryLog(tx, {
            outboxId: row.id,
            recipient: row.recipient,
            templateKey: row.templateKey,
            eventType: row.eventType,
            subject: SUBJECTS[template] ?? null,
            status: dead ? "DEAD" : "FAILED",
            attemptNumber: attempt,
            eventId,
            domainId,
            assignmentId,
            reason: errorMsg,
          });
        });
      }
      failed += 1;
      logger.warn("outbox_send_failed", { id: row.id, attempt, dead });
    }
  }

  return { sent, failed, deferred, suppressed };
}
