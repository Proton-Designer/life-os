import { cache } from "react";
import { createClient } from "./server";

// cache() memoizes this per-request (React's request-scoped dedup, not a
// cross-request cache) — every layout/page/leaf-component/Server-Action call
// site can independently call getAuthedUser() for its own defense-in-depth
// auth check without each one paying its own network round trip to Supabase
// Auth. Matches the DAL pattern from Next's own App Router auth guide.
export const getAuthedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
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
