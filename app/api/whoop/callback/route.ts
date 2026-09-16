import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase/auth";
import { isWhoopConfigured } from "@/lib/whoop/config";
import { exchangeWhoopAuthorizationCode } from "@/lib/whoop/client";
import { saveWhoopConnectionCore } from "@/lib/whoop/connection-core";
import { WHOOP_OAUTH_STATE_COOKIE } from "@/lib/whoop/oauth-state";

/**
 * P3-18 -- Whoop OAuth2 callback. Per the Lead's explicit ruling:
 *  - fails closed (redirects with an error, does nothing else) when
 *    WHOOP_CLIENT_ID/SECRET are unset -- checked FIRST, before touching
 *    the state cookie or the query string at all.
 *  - validates `state` against the httpOnly cookie set at authorize time
 *    (CSRF) -- a missing/mismatched state aborts before any token
 *    exchange is attempted.
 *  - never logs or returns a token/code anywhere (no console.log in this
 *    file at all; every redirect carries only a short error CODE in its
 *    query string, never a message built from response content).
 */
export const dynamic = "force-dynamic";

function errorRedirect(request: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?whoop_error=${code}#whoop`, request.url));
}

export async function GET(request: Request) {
  if (!isWhoopConfigured()) return errorRedirect(request, "not_configured");

  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
  try {
    ({ supabase, userId } = await requireUser());
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorRedirect(request, "missing_code_or_state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(WHOOP_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(WHOOP_OAUTH_STATE_COOKIE);
  if (!expectedState || state !== expectedState) return errorRedirect(request, "state_mismatch");

  const redirectUri = `${url.origin}/api/whoop/callback`;
  const result = await exchangeWhoopAuthorizationCode(code, redirectUri);
  if (!result.ok) return errorRedirect(request, "exchange_failed");

  try {
    await saveWhoopConnectionCore(supabase, userId, result.data);
  } catch {
    return errorRedirect(request, "save_failed");
  }

  return NextResponse.redirect(new URL("/settings?whoop_connected=1#whoop", request.url));
}
