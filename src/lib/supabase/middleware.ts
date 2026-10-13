import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimitResponse, takeRateLimit } from "@/lib/security/rate-limit";

/**
 * Refreshes the Supabase session cookies on every matched request and returns
 * the response that carries them. This is an early UX guard + refresh only —
 * every server page/route re-verifies identity independently.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Global per-client API budget, enforced BEFORE any session/database work so
  // an anonymous flood is rejected cheaply. Per-route budgets live in the API
  // route wrapper (see lib/api/route.ts).
  if (path.startsWith("/api")) {
    const global = takeRateLimit(request, "global");
    if (!global.allowed) return rateLimitResponse(request, global);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: no logic between createServerClient and this auth call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/unauthorized") ||
    path === "/nss-logo.png" ||
    path === "/nss-logo.jpg" ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    // Browser navigation → redirect to login. API/JSON callers get 401 from
    // the route handler itself; returning JSON here avoids HTML redirects.
    if (path.startsWith("/api")) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
