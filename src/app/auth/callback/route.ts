import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rateLimitResponse, takeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/observability/logger";

/**
 * Google OAuth PKCE callback: exchanges the code for a session and redirects.
 * Never renders private data; only sets the session cookies.
 */
export async function GET(request: NextRequest) {
  // Each exchange hits the auth server — keep code replay/flood attempts bounded.
  const rate = takeRateLimit(request);
  if (!rate.allowed) return rateLimitResponse(request, rate);

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Only allow same-origin relative redirects.
  const safeNext = next.startsWith("/") ? next : "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=missing_code`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logger.warn("oauth_exchange_failed", { reason: error.message });
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=exchange_failed`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
