import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import type { RunMcpToolOutcome } from "../tool-wrapper";

/**
 * `list_tasks_due_today` — genuinely useful (what does this account have
 * due right now?), and deliberately chosen to exercise AGENTS.md's
 * timezone rule: "today" for an MCP caller has no browser-local clock to
 * derive it from the way a page render does, so it MUST come from the
 * account's own stored `profiles.timezone` via `localDateString`, never
 * from the server's own clock or a raw `new Date()` comparison. Getting
 * this wrong here would reproduce the exact class of bug AGENTS.md
 * documents being hit three times in one night against `lib/prayer-times`.
 */
export async function listTasksDueTodayTool(supabase: SupabaseClient<Database>, userId: string): Promise<RunMcpToolOutcome> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, domain, title, due_date, due_time, completed, completed_at")
    .eq("user_id", userId)
    .eq("due_date", today)
    .order("due_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  const tasks = data ?? [];
  return {
    result: {
      content: [{ type: "text", text: JSON.stringify(tasks) }],
      structuredContent: { date: today, tasks },
    },
    summary: `returned ${tasks.length} task(s) due ${today}`,
  };
}
