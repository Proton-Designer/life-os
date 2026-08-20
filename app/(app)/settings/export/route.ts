import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";

const USER_SCOPED_TABLES = [
  "profiles",
  "prayers",
  "adhkar_logs",
  "custom_habits",
  "habit_logs",
  "quran_sessions",
  "weekly_goals",
  "kill_list_items",
  "workout_schedule",
  "exercises",
  "workouts",
  "workout_exercises",
  "workout_sessions",
  "session_sets",
  "body_metrics",
  "rep_goals",
  "tasks",
  "schedule_events",
  "checkins",
  "push_subscriptions",
] as const;

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const entries = await Promise.all(
    USER_SCOPED_TABLES.map(async (table) => {
      const { data } = await supabase.from(table).select("*").eq("user_id", user.id);
      return [table, data ?? []] as const;
    })
  );

  const exportData = Object.fromEntries(entries);
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="life-os-export-${dateStr}.json"`,
    },
  });
}
