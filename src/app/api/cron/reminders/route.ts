import { NextResponse } from "next/server";
import { runDeadlineReminders } from "@/services/reminder-service";
import { runMonthlyDigest } from "@/services/monthly-digest-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

/**
 * Scheduled worker: queues 4-day, 24-hour and 1-hour deadline reminders, plus
 * the start-of-month task digest. Protected by the CRON_SECRET bearer token.
 * GET is used by platform schedulers (Vercel Cron); POST kept for external
 * schedulers. Missing secret → 503; wrong secret → 401. Idempotent: reminder
 * outbox keys and the digest month key prevent duplicate enqueues.
 */
async function runWorker(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Reminder worker is not configured." } },
      { status: 503 },
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  try {
    const reminders = await runDeadlineReminders();
    let digest: Awaited<ReturnType<typeof runMonthlyDigest>> | null = null;
    try {
      digest = await runMonthlyDigest();
    } catch (err) {
      logger.error("monthly_digest_worker_failed", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
    return NextResponse.json(
      { ...reminders, digest },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    logger.error("reminder_worker_failed", { message: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Reminder run failed." } },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
