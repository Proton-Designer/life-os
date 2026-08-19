import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

export async function updateSession(request: NextRequest) {
  // Next.js layouts have no built-in pathname access (unlike usePathname()
  // in Client Components) — inject it as a request header so app/(app)/
  // layout.tsx can tell whether it's already rendering /onboarding, and
  // avoid redirecting to itself in a loop.
  const requestWithPathname = new Headers(request.headers);
  requestWithPathname.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({ request: { headers: requestWithPathname } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL environment variable. Set it in .env.local."
    );
  }
  if (!anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable. Set it in .env.local."
    );
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request: { headers: requestWithPathname } });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refreshes the auth session (expired-token rotation) before the request
  // hits Server Components — required by @supabase/ssr's App Router pattern.
  //
  // getClaims() rather than getUser(): same tradeoff as lib/supabase/auth.ts
  // (Phase 4) — local ES256/JWKS verification (~1ms) instead of a network
  // round trip to the Auth server (~80ms), measured 345ms -> 182ms mean
  // server time for this call specifically. getClaims() runs the same lazy
  // refresh path under the hood, so expired-token rotation is unaffected.
  // The real tradeoff: this was the last server-contacting revocation check
  // in the app (lib/supabase/auth.ts's own comment used to point back here
  // as the exception) — a remotely-revoked session now survives until its
  // next token refresh (exp - iat = 3600s on this project, ~30min average
  // in practice) instead of dying on the next request. Accepted for a
  // single-user personal app; see
  // docs/superpowers/specs/2026-08-18-navigation-prefetch-fix.md Part B.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
