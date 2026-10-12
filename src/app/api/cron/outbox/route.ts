import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/email/outbox";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

/**
 * Scheduled worker: delivers pending transactional emails from the outbox with
 * retry/backoff. Protected by a bearer secret (CRON_SECRET). SMTP failure never
 * affects already-committed business data.
 *
 * Trigger from a scheduler (e.g. every minute). Not part of the user session
 * flow, so it does not require a login cookie.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Outbox worker is not configured." } },
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
    const result = await processOutbox(25);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    logger.error("outbox_worker_failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Outbox run failed." } },
      { status: 500 },
    );
  }
}
