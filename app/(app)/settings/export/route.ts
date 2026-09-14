import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";

// #32 audit (2026-09-14): queried information_schema/pg_constraint for every
// public table carrying a user_id column (77 total) and diffed it against this
// list, which had drifted down to 20 — most of the app's actual feature
// surface (time tracking, Deen habits, distractions, co-op, school grades,
// Self-Mastery's whole SRS pipeline, fitness plans, account/domain config)
// was silently absent from a user's own data export. `custom_habits` stays
// despite being 0 rows on this account: it's a live insert path
// (app/(app)/fitness/actions.ts's addHabit), not dead code — 0 rows here
// just means this account never created one, and the export must still
// include it for the account that does.
//
// Deliberately excluded, every one for a stated reason rather than by
// omission — see the batch below this array:
//   ai_usage_log, mcp_audit_log, mcp_notification_dispatch_log,
//   mcp_scheduled_actions, ingestion_job_stage_attempts, notification_log,
//   notification_reads — internal operational/telemetry logs, not content
//   the user authored; every table THEY populated by using a feature is
//   exported through that feature's own table already.
//   mcp_access_tokens, mcp_oauth_codes, mcp_oauth_refresh_tokens,
//   user_api_keys — hold token hashes / an encrypted third-party API key.
//   Handing secret-adjacent material out in a downloadable JSON file is a
//   security regression, not a completeness one, even hashed/encrypted.
//   pending_storage_deletions — internal storage-GC queue; its own RLS
//   policy is `USING (false)` for every authenticated role, so this
//   cookie-authed route couldn't read it even if listed.
//   migration_115_orphaned_group_weight_log — a migration-era scratch
//   table: 0 rows, and the ONE public table with a user_id column that has
//   no FK to auth.users at all (verified via pg_constraint) — not live user
//   data, flagged separately as a cleanup candidate, not an export gap.
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
  // --- Added by the #32 audit below, grouped by feature ---
  // Time tracking (Work/Business) — 489+ live rows, the single biggest gap.
  "work_sessions",
  "work_session_objectives",
  // Deen
  "deen_habits",
  "deen_habit_logs",
  "deen_weekly_focus",
  "sunnah_logs",
  "reflection_entries",
  // Distractions/triggers, including the plan-rewrite feature evening-close
  // links to (AuthedShell's own comment calls this the "three-strike plan").
  "distraction_triggers",
  "distraction_events",
  "trigger_action_plans",
  "trigger_plan_outcomes",
  // Co-op/Work targets
  "coop_targets",
  "coop_tasks",
  // School — classes, grading
  "classes",
  "class_assessments",
  "grade_categories",
  "schedule_event_cancellations",
  "schedule_event_overrides",
  // Self-Mastery — ingested books through to the full spaced-repetition
  // pipeline (cards/card_states/reviews are the account's actual study
  // history, not incidental data).
  "books",
  "book_sections",
  "source_chunks",
  "sources",
  "ingestion_jobs",
  "lessons",
  "lesson_promotions",
  "lesson_verdicts",
  "questions",
  "cards",
  "card_states",
  "reviews",
  "self_explanations",
  // Fitness — plans beyond the already-listed workout/session tables.
  "workout_plans",
  "active_workout_plans",
  "plan_sessions",
  "plan_session_exercises",
  "plan_micro_exercises",
  "fitness_benchmarks",
  "fitness_cycle_anchor",
  // Check-ins beyond the already-listed `checkins` row itself.
  "checkin_allocations",
  // Account-level config
  "user_domains",
  "user_subdomains",
  "user_settings",
  "user_stats",
  // MCP home-dashboard widgets the user configured — config, not a secret
  // (contrast mcp_access_tokens/mcp_oauth_*, excluded above).
  "mcp_widgets",
  // Goals (#43/#44, migration 165 proposed — see that file) — a ranked monthly portfolio and its
  // milestones. Added the same day the tables were, so this allowlist is
  // never again silently incomplete for a brand-new table the way this
  // file's own header describes happening to the original 20.
  "goals",
  "goal_milestones",
] as const;

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const entries = await Promise.all(
    USER_SCOPED_TABLES.map(async (table) => {
      // `goals`/`goal_milestones` (migration 165, proposed) aren't in the generated
      // `database.types.ts` yet -- that file is regenerated FROM the live
      // database when a migration is actually applied (never hand-edited;
      // see supabase/migrations/ALLOCATIONS.md), and 165 is written+proved
      // but deliberately not applied by this track. The cast is provisional:
      // once the lead applies it and types regenerate, `table` typechecks
      // against the real union again with no code change needed here.
      const { data } = await supabase.from(table as never).select("*").eq("user_id", user.id);
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
