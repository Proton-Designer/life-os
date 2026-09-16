import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/supabase/auth";
import { isWhoopConfigured } from "@/lib/whoop/config";
import { buildWhoopAuthorizeUrl } from "@/lib/whoop/client";
import { WHOOP_OAUTH_STATE_COOKIE, WHOOP_OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/whoop/oauth-state";

/**
 * P3-18 -- starts the Whoop OAuth2 flow. Fails closed (redirects back to
 * Settings with an error) when WHOOP_CLIENT_ID/SECRET are unset, per the
 * Lead's explicit ruling -- this is the ONLY reachable path in this
 * deployment right now (no Whoop app registered).
 *
 * `state` (CSRF, OAuth2's own documented mitigation) is a fresh random
 * value bound to THIS session via an httpOnly cookie, checked again at
 * the callback -- never trusts a state value the callback alone provides.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isWhoopConfigured()) {
    return NextResponse.redirect(new URL("/settings?whoop_error=not_configured#whoop", request.url));
  }

  const state = randomBytes(32).toString("base64url");
  const redirectUri = new URL("/api/whoop/callback", request.url).toString();
  const authorizeUrl = buildWhoopAuthorizeUrl(redirectUri, state);

  const cookieStore = await cookies();
  cookieStore.set(WHOOP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: WHOOP_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/api/whoop",
  });

  return NextResponse.redirect(authorizeUrl);
}
