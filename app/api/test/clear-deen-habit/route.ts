import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/habit-stage-override.spec.ts). There is no delete
// UI anywhere in the app for a Habit Builder habit (deen_habits) — "Remove"
// (archiveDeenHabit) sets `archived = true` and leaves the row in place,
// which is correct product behavior (an archived habit's history is kept)
// but means a spec that creates a throwaway habit has no in-app way to
// remove it again. Found needed 2026-09-15 (full-suite triage): the spec's
// own UI-based cleanup at the end of its happy path is the ONLY cleanup it
// had — a failure anywhere before that point (the checkin-toast
// interception this file's own fix addresses) leaked the row, unarchived,
// permanently.
//
// Same secret-gated shape as every other test-only clear-* route
// (clear-goal, clear-distraction-trigger, clear-habit for identity_habits).
// Deletes outright, not just archives — an accumulating pile of archived
// "Playwright override habit <timestamp>" rows would still clutter this
// account's real history even though the app itself would never show them.
export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { name } = (await request.json()) as { name: string };
  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const { error } = await supabase.from("deen_habits").delete().eq("user_id", user.id).eq("name", name);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
