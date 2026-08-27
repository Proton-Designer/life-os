import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/lock-in-overlay.spec.ts). A leftover Lock-In
// session is the worst residue this suite can produce: startWorkSession has
// a single-active-session guard, so ONE orphan makes every later test in
// that file — and Home's Focus module generally — unable to start anything
// at all. The first run of that spec proved it: the feature worked, a
// UI-driven teardown timed out, and the five tests after it failed for a
// reason that had nothing to do with the code.
//
// UI teardown was the original approach and it is not reliable enough for
// this: it has to navigate with a modal open, dismiss a check-in dialog
// that may or may not appear, minimize, then find and click the right one
// of two similarly-named buttons — every step a chance to hang inside an
// afterEach that Playwright caps at the test timeout. This closes the row
// directly, in one request, with no UI in the path.
//
// Deliberately closes ALL open sessions for the user rather than one id:
// the caller is cleaning up, and if a previous run already orphaned one,
// the whole point is to clear it too.
export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await supabase
    .from("work_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("ended_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
