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
