import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, getWeekStartDate, localDateString } from "@/lib/date-utils";
import { ToolInputError } from "@/lib/mcp/tool-input-error";
import { getMostRecentCompletedWeek } from "./week-range";

/**
 * A weekly review narrative written by an agent through the connector, replacing the built-in one (migration 275; same pattern as
 * the agent Morning Brief, lib/morning-brief/agent-brief-core.ts). The week is a Sun-Sat week identified by its Sunday: the most
 * recently completed week (the default) or the current one (the "this week so far" view).
 */

/** The week_start an agent may write: default = the last completed week; the current week is also allowed. */
export function resolveAgentWeekStart(raw: unknown, now: Date, timezone: string): string {
  const today = localDateString(now, timezone);
  const completed = getMostRecentCompletedWeek(today).startDate;
  if (raw === undefined || raw === null) return completed;
  const current = getWeekStartDate(today);
  const isDate = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && addDaysToDateString(raw, 0) === raw;
  if (!isDate || (raw !== completed && raw !== current)) {
    throw new ToolInputError(
      `patch.week_start must be the Sunday that starts the last completed week (${completed}) or the current week (${current}). Got: ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

export async function writeAgentWeeklyNarrativeCore(supabase: SupabaseClient, input: { weekStart: string; text: string; tokenId?: string }): Promise<void> {
  const { error } = await supabase.rpc("write_agent_weekly_narrative", { p_week_start: input.weekStart, p_text: input.text, p_token_id: input.tokenId ?? null });
  if (error) throw error;
}

export async function clearAgentWeeklyNarrativeCore(supabase: SupabaseClient, weekStart: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("clear_agent_weekly_narrative", { p_week_start: weekStart });
  if (error) throw error;
  return Number(data) > 0;
}
