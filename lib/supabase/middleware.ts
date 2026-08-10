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
  await supabase.auth.getUser();

  return supabaseResponse;
}
