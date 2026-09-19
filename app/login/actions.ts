"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safeNextPath } from "@/lib/auth/safe-next";

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });
  if (error) return { error: error.message };
  // PRIVACY fix (Opus Lead ruling, 2026-09-18), not just staleness: on a
  // shared device, or a logout-then-login-as-a-different-user, the client
  // Router Cache can still hold the PREVIOUS session's rendered "/" —
  // without this, a successful sign-in could serve user A's cached Home to
  // user B. Layout-level (not page-level), same as completeOnboarding
  // (app/(app)/onboarding/actions.ts) and for the same reason: the nav
  // shell itself is per-account (legacy vs domains, hidden/enabled
  // features), not just the page content below it. Before redirect() —
  // it works by throwing, so a call placed after it never runs.
  revalidatePath("/", "layout");
  // P4-13: return to a same-origin `next` (e.g. the MCP OAuth consent screen); anything else goes Home.
  redirect(safeNextPath(formData.get("next") as string | null) ?? "/");
}
