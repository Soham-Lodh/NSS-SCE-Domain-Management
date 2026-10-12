import { NextResponse } from "next/server";
import { runDeadlineReminders } from "@/services/reminder-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

/**
 * Scheduled worker: queues 4-day and 24-hour deadline reminders for assigned
 * volunteers. Protected by the CRON_SECRET bearer token. Idempotent.
 */
export async function POST(request: Request) {
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
    const result = await runDeadlineReminders();
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    logger.error("reminder_worker_failed", { message: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Reminder run failed." } },
      { status: 500 },
    );
  }
}
