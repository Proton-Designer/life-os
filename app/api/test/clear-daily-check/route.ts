import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { ensureDailyCheckHabits } from "@/app/(app)/fitness/actions";

// Test-only endpoint (e2e/fitness.spec.ts): toggleDailyCheck only flips
// today's habit_logs row, and pendingDailyLog (lib/fitness/daily-log.ts)
// filters completed items out of what the Daily Log actually renders — so
// a daily_check row the UI shows is ALWAYS currently pending, never
// already-done, and completing it removes the only button that could
// otherwise flip it back. Same problem class as clear-prayer (markPrayer
// has no "return to pending" value either): this deletes today's row,
// restoring exactly the "not logged today" state the item was always in
// before a test touched it.
function checkSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.E2E_TEST_SECRET;
  return !!expectedSecret && request.headers.get("x-e2e-secret") === expectedSecret;
}

export async function DELETE(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { kind } = (await request.json()) as { kind: "protein" | "steps" };
  if (kind !== "protein" && kind !== "steps") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle();
  const dateStr = localDateString(new Date(), profile?.timezone ?? "UTC");
  const habitIds = await ensureDailyCheckHabits();

  const { error } = await supabase.from("habit_logs").delete().eq("habit_id", habitIds[kind]).eq("date", dateStr);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
