import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { requestIdOf } from "@/lib/api/response";
import { logger } from "@/lib/observability/logger";

/**
 * Logout. Attempts to write a LOGOUT audit event WHILE the session is still
 * valid, then clears the session. Documented limitation: browser close or an
 * already-expired session cannot be observed, so logout auditing is
 * best-effort and never blocks sign-out.
 */
export async function POST(request: Request) {
  const requestId = requestIdOf(request);
  try {
    const ctx = await getAuthContext();
    if (ctx) {
      await prisma.auditLog.create({
        data: {
          actorAppUserId: ctx.appUserId,
          action: "LOGOUT",
          targetType: "AppUser",
          targetId: ctx.appUserId,
          outcome: "SUCCESS",
          requestId,
        },
      });
    }
  } catch (err) {
    logger.warn("logout_audit_failed", { requestId, message: err instanceof Error ? err.message : "unknown" });
  }

  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
