import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/lib/env";

/**
 * Brevo transactional email over SMTP. Server-only. Credentials come from
 * environment variables and are never logged.
 *
 * Returns null when SMTP is not configured so the outbox can record a clear
 * "not configured" state instead of throwing on every send.
 */
let cachedTransport: Transporter | null | undefined;

function transport(): Transporter | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const env = serverEnv();
  if (!env.BREVO_SMTP_USER || !env.BREVO_SMTP_PASSWORD) {
    cachedTransport = null;
    return null;
  }
  cachedTransport = nodemailer.createTransport({
    host: env.BREVO_SMTP_HOST,
    port: env.BREVO_SMTP_PORT,
    secure: env.BREVO_SMTP_PORT === 465,
    auth: { user: env.BREVO_SMTP_USER, pass: env.BREVO_SMTP_PASSWORD },
  });
  return cachedTransport;
}

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(email: OutboundEmail): Promise<void> {
  const t = transport();
  if (!t) throw new Error("SMTP is not configured.");
  const env = serverEnv();
  await t.sendMail({
    from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM}>`,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

/** Basic HTML escaping for any dynamic value interpolated into templates. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
