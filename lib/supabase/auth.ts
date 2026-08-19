import { cache } from "react";
import { createClient } from "./server";

// cache() memoizes this per-request (React's request-scoped dedup, not a
// cross-request cache) — every layout/page/leaf-component/Server-Action call
// site can independently call getAuthedUser() for its own defense-in-depth
// auth check without each one paying its own network round trip to Supabase
// Auth. Matches the DAL pattern from Next's own App Router auth guide.
//
// getClaims() rather than getUser(): this project signs its access tokens
// with ES256 against a published JWKS, so getClaims() verifies the JWT
// locally (~1ms) instead of making a network round trip to the Auth server
// (~80ms) — see docs/superpowers/specs/2026-08-16-navigation-latency-fix.md
// Phase 4. getClaims() still runs the same lazy session-init/refresh path as
// getUser()/getSession() under the hood (refreshes an expired access token
// via the refresh token and writes it back to cookies), so token rotation is
// unaffected. The real tradeoff: a *revoked-but-not-yet-expired* session is
// no longer caught here, since local verification never asks the Auth
// server. lib/supabase/middleware.ts (proxy.ts's session refresh) made the
// same move in the 2026-08-18 navigation-prefetch-fix Part B, so there is
// no longer a server-contacting revocation check anywhere in the request
// path — accepted there for the same single-user-app reasoning. Only
// callers that read `.id`/
// `.email` off the return value exist in this codebase (verified before
// this change) — the mapped shape below covers exactly that.
export const getAuthedUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const { claims } = data;
  return { id: claims.sub, email: claims.email };
});

export async function requireUser() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

// Same cache()-per-request pattern as getAuthedUser(): the profiles row was
// previously fetched separately in the layout (onboarding check), the
// check-in loader (timezone/window fields), and nearly every page.tsx (its
// own subset of fields) — 2-4 round trips per request for the same row.
// Selects the full row once; callers destructure only what they need, same
// as before. Deliberately does NOT accept a userId param — derives it from
// getAuthedUser() itself so every call site is guaranteed to be asking for
// the current request's own user, not something a caller could pass wrong.
export const getProfile = cache(async () => {
  const user = await getAuthedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
});
