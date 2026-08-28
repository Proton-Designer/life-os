import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { checkSecret } from "../check-secret";

// Test-only endpoint (e2e/work-pipeline.spec.ts): the Past section's 7-day
// boundary (lib/coop/tasks.ts's isPastCompletedTask) can't be waited out in
// a real run, so this creates a task already in `complete` status with a
// `completed_at` computed from the ACCOUNT'S OWN profile timezone — never
// the test runner's raw clock — same discipline as
// save-allocation-checkin/route.ts's window computation. `daysAgo` is a
// whole calendar-day offset from today's local date (never a raw hour
// subtraction, which would drift near a DST or UTC-rollover boundary);
// `hour`/`minute` place the instant within that local day, which is what
// lets the spec pin the exact 18:59-vs-19:01-local pair AGENTS.md calls
// out — both must classify identically since isPastCompletedTask only
// ever compares calendar dates, never clock time.
export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    targetId?: string;
    title?: string;
    daysAgo?: number;
    hour?: number;
    minute?: number;
  };
  const { targetId, title, daysAgo = 0 } = body;
  const hour = body.hour ?? 12;
  const minute = body.minute ?? 0;
  if (!targetId || !title) {
    return NextResponse.json({ error: "targetId and title are required" }, { status: 400 });
  }

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);
  const completedDateStr = addDaysToDateString(todayStr, -daysAgo);
  const completedAt = resolveLocalTime(completedDateStr, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, timezone);

  const { data: task, error } = await supabase
    .from("coop_tasks")
    .insert({ target_id: targetId, title, status: "complete", completed_at: completedAt.toISOString() })
    .select("id")
    .single();
  if (error || !task) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ taskId: task.id, completedAt: completedAt.toISOString() });
}
