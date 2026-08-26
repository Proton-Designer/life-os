import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/distractions.spec.ts): there is no delete UI for a
// trigger anywhere in the app — archiving/removal wasn't part of tonight's
// spec — so a test that creates one has no in-app way to remove it again.
// distraction_events/trigger_action_plans/trigger_plan_outcomes all
// reference trigger_id ON DELETE CASCADE (migration 041), so deleting the
// trigger row here is sufficient teardown for everything a test created
// under it. Same secret-gated shape as the other test-only routes.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { name, domain } = (await request.json()) as { name: string; domain: string };
  if (!name || !domain) {
    return NextResponse.json({ error: "name and domain are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("distraction_triggers")
    .delete()
    .eq("user_id", user.id)
    .eq("domain", domain)
    .eq("name", name);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
