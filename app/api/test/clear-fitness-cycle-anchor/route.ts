import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/fitness.spec.ts): app/(app)/fitness/page.tsx lazily
// creates a fitness_cycle_anchor row the first time it's rendered with an
// active plan and no anchor yet — there is no UI affordance to delete it
// (deactivating/deleting the plan deliberately leaves it, per that page's
// own comment, so a returning user's cycle history isn't silently reset).
// A test that activates a throwaway plan against a previously-anchor-less
// account has no way to revert that side effect through the app itself.
// Same secret-gated shape as clear-prayer/answer-checkin.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.from("fitness_cycle_anchor").delete().eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
