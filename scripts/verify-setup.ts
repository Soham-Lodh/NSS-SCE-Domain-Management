/**
 * Setup verification — run with:  npx tsx scripts/verify-setup.ts
 *
 * Loads .env then .env.local, validates the environment shape, and checks live
 * connectivity to Postgres, Supabase Auth and Brevo SMTP.
 *
 * It NEVER prints secret values — only status and non-sensitive counts.
 */
import { readFileSync, existsSync } from "node:fs";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1] as string] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

async function main() {
  const results: string[] = [];
  const ok = (m: string) => results.push(`  ✅ ${m}`);
  const bad = (m: string) => results.push(`  ❌ ${m}`);
  const info = (m: string) => results.push(`  •  ${m}`);

  // 1. Environment shape (names only on failure)
  const { serverEnv } = await import("../src/lib/env");
  try {
    const env = serverEnv();
    ok("Environment variables present and well-formed.");
    info(`APP_URL set: ${env.APP_URL}`);
    info(`ORGANIZATION_TIMEZONE: ${env.ORGANIZATION_TIMEZONE}`);
    info(`ALLOWED_EMAIL_DOMAINS: ${env.ALLOWED_EMAIL_DOMAINS}`);
    info(`BREVO_SMTP_HOST: ${env.BREVO_SMTP_HOST}:${env.BREVO_SMTP_PORT}`);
    info(`BOOTSTRAP_COORDINATOR_EMAIL configured: ${env.BOOTSTRAP_COORDINATOR_EMAIL ? "yes" : "no"}`);
  } catch (e) {
    bad(`Environment invalid: ${e instanceof Error ? e.message : "unknown"}`);
  }

  if (!process.env.CRON_SECRET) info("CRON_SECRET not set (outbox/reminder workers disabled).");

  // 2. Postgres
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Database connection OK.");
    const [domains, persons, memberships, events] = await Promise.all([
      prisma.domain.count(),
      prisma.person.count(),
      prisma.volunteerMembership.count(),
      prisma.event.count(),
    ]);
    info(`Tables readable — domains:${domains} people:${persons} memberships:${memberships} events:${events}`);
    if (domains === 0) info("No domains yet — create domains before importing volunteers.");
  } catch (e) {
    bad(`Database check failed: ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}`);
    info("If the schema is missing, run: npm run prisma:migrate (or prisma:deploy).");
  } finally {
    await prisma.$disconnect();
  }

  // 3. Supabase Auth
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      });
      if (res.ok) ok(`Supabase Auth reachable (HTTP ${res.status}).`);
      else bad(`Supabase Auth returned HTTP ${res.status}.`);
    } catch {
      bad("Supabase Auth unreachable (check NEXT_PUBLIC_SUPABASE_URL).");
    }
  } else {
    bad("NEXT_PUBLIC_SUPABASE_URL not set.");
  }

  // 4. Brevo SMTP
  if (process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASSWORD) {
    try {
      const nodemailer = await import("nodemailer");
      const t = nodemailer.createTransport({
        host: process.env.BREVO_SMTP_HOST,
        port: Number(process.env.BREVO_SMTP_PORT ?? 587),
        secure: Number(process.env.BREVO_SMTP_PORT ?? 587) === 465,
        auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_PASSWORD },
      });
      await t.verify();
      ok("Brevo SMTP login OK (transport verified).");
    } catch (e) {
      bad(`SMTP verify failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  } else {
    info("Brevo SMTP credentials not set — email delivery disabled.");
  }

  console.log("\n=== SETUP VERIFICATION ===\n" + results.join("\n") + "\n");
}

main().catch((e) => {
  console.error("verify-setup crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
