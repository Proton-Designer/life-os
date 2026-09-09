import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { RunMcpToolOutcome } from "../tool-wrapper";

/**
 * `get_profile` — the simplest possible read, and the point is exactly
 * that: it proves the whole bearer-auth -> minted-session -> RLS chain
 * resolved to the RIGHT account, with nothing else in the way. R5's
 * `core(supabase, userId, ...)` shape: no `requireUser()`, no
 * `getProfile()` — this takes the already-resolved, already-RLS-scoped
 * client and userId as plain arguments, same rule the cookie-authed Server
 * Actions must follow too.
 */
export async function getProfileTool(supabase: SupabaseClient<Database>, userId: string): Promise<RunMcpToolOutcome> {
  // RLS already scopes this to the caller's own row (the minted JWT's `sub`
  // IS userId), but this codebase has a real history of RLS-sweep
  // incidents (058, 086, 100/101 — see lib/supabase/service-role.ts's own
  // comment) and every cookie-authed action in it explicitly scopes by
  // user_id too, belt-and-suspenders. Matching that convention here rather
  // than trusting RLS alone.
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, timezone, prayer_calc_method, asr_madhab")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const profile = data ?? {};
  return {
    result: {
      content: [{ type: "text", text: JSON.stringify(profile) }],
      structuredContent: profile as Record<string, unknown>,
    },
    summary: data ? "returned profile" : "no profile row yet",
  };
}
