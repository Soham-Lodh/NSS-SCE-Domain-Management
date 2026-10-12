import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import { escapeHtml, sendEmail, type OutboundEmail } from "@/lib/email/brevo";

type Tx = Prisma.TransactionClient;

export type EmailTemplateKey =
  | "ROLE_ASSIGNED"
  | "DOMAIN_LEAD_ASSIGNED"
  | "EVENT_ASSIGNED"
  | "ASSIGNMENT_REMOVED"
  | "EVENT_REMINDER_4D"
  | "EVENT_REMINDER_24H"
  | "EVENT_COMPLETED"
  | "ACCOUNT_DEACTIVATED";

const SUBJECTS: Record<EmailTemplateKey, string> = {
  ROLE_ASSIGNED: "Your NSS SCE KIIT role was updated",
  DOMAIN_LEAD_ASSIGNED: "You were assigned as a domain lead",
  EVENT_ASSIGNED: "You have been assigned to an event",
  ASSIGNMENT_REMOVED: "You were removed from an event",
  EVENT_REMINDER_4D: "Reminder: an assigned task is due in 4 days",
  EVENT_REMINDER_24H: "Reminder: an assigned task is due in 24 hours",
  EVENT_COMPLETED: "An event you were assigned to was completed",
  ACCOUNT_DEACTIVATED: "Your NSS SCE KIIT account was deactivated",
};

function renderBody(template: EmailTemplateKey, payload: Record<string, unknown>): {
  html: string;
  text: string;
} {
  const lines = Object.entries(payload)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}: ${escapeHtml(String(v))}`);
  const text = `${SUBJECTS[template]}\n\n${lines.join("\n")}\n\n— NSS SCE KIIT`;
  const html = `<div style="font-family:system-ui,sans-serif;color:#2F3976">
    <h2 style="color:#2F3976">${SUBJECTS[template]}</h2>
    <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    <p style="color:#2F3976">— NSS SCE KIIT</p>
  </div>`;
  return { html, text };
}

/**
 * Enqueue an email INSIDE the business transaction. Delivery happens after
 * commit, so a failed send can never roll back committed work.
 */
export async function enqueueEmail(
  tx: Tx,
  args: {
    eventType: string;
    templateKey: EmailTemplateKey;
    recipient: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<void> {
  await tx.emailOutbox.create({
    data: {
      eventType: args.eventType,
      templateKey: args.templateKey,
      recipient: args.recipient,
      payloadJson: args.payload as Prisma.InputJsonValue,
      status: "PENDING",
      nextAttemptAt: new Date(),
      idempotencyKey: args.idempotencyKey ?? null,
    },
  });
}

const MAX_ATTEMPTS = 5;

/** Backoff: 1m, 4m, 9m, 16m… capped. */
function backoffMs(attempt: number): number {
  return Math.min(attempt * attempt * 60_000, 60 * 60_000);
}

/**
 * Deliver pending outbox rows. Intended to be called from a scheduled job /
 * cron route. Failures are recorded and retried with backoff — never thrown.
 */
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.emailOutbox.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const template = row.templateKey as EmailTemplateKey;
    try {
      const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
      const body = renderBody(template, payload);
      const email: OutboundEmail = {
        to: row.recipient,
        subject: SUBJECTS[template] ?? "NSS SCE KIIT notification",
        ...body,
      };
      await sendEmail(email);
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), attemptCount: { increment: 1 } },
      });
      sent += 1;
    } catch (err) {
      const attempt = row.attemptCount + 1;
      const dead = attempt >= MAX_ATTEMPTS;
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: dead ? "DEAD" : "PENDING",
          attemptCount: attempt,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
          lastErrorSummary: (err instanceof Error ? err.message : "unknown").slice(0, 300),
        },
      });
      failed += 1;
      logger.warn("outbox_send_failed", { id: row.id, attempt, dead });
    }
  }

  return { sent, failed };
}
