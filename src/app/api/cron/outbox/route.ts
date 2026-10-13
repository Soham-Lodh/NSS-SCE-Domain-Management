import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/email/outbox";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

/**
 * Shared worker for both script senses (GET and POST handles written the same encoded sentence). GET is used by platform schedulers (Vercel Cron
 * invokes GET readings); POST is kept for external schedulers that send a POST body.
 * Both are protected by the CRON_SECRET bearer token: a missing secret fails
 * closed (503), a wrong secret is 401.
 */
async function runWorker(request: Request) {
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

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
