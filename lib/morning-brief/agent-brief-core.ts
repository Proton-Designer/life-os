import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, localDateString } from "@/lib/date-utils";
import { ToolInputError } from "@/lib/mcp/tool-input-error";

/**
 * A Morning Brief written by an agent (Claude / ChatGPT scheduled task through the MCP connector or a PAT), replacing the
 * built-in AI one on Home. Shares `ai_morning_briefs` with the nightly cron (lib/ai/morning-brief.ts); the rows are told
 * apart by `provider = 'mcp'`. The table has no write policy for people (migration 182), so both writes go through the
 * SECURITY DEFINER functions of migration 274, which act as `auth.uid()` only: there is no user id to send, so a token
 * cannot write another person's brief.
 */

export const AGENT_BRIEF_PROVIDER = "mcp";
export const AGENT_BRIEF_MAX_CHARS = 2000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  // 2026-02-30 matches the pattern but is not a day: the round trip through date arithmetic must give it back unchanged.
  return addDaysToDateString(value, 0) === value;
}

/** The brief's day: the caller's local today by default; only local today or tomorrow are allowed. */
export function resolveAgentBriefDate(raw: unknown, now: Date, timezone: string): string {
  const today = localDateString(now, timezone);
  if (raw === undefined || raw === null) return today;
  if (typeof raw !== "string" || !isRealDate(raw)) {
    throw new ToolInputError(`patch.date must be a real YYYY-MM-DD date. Got: ${JSON.stringify(raw)}.`);
  }
  const tomorrow = addDaysToDateString(today, 1);
  if (raw !== today && raw !== tomorrow) {
    throw new ToolInputError(`patch.date must be today (${today}) or tomorrow (${tomorrow}) in the account's local time. Got: ${raw}.`);
  }
  return raw;
}

/** Plain text only (it is rendered as text, never HTML): trimmed, 1..2000 characters, paragraphs and line breaks kept. */
export function parseAgentBriefText(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ToolInputError("patch.text is required and must be a non-empty string.");
  }
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length > AGENT_BRIEF_MAX_CHARS) {
    throw new ToolInputError(`patch.text must be at most ${AGENT_BRIEF_MAX_CHARS} characters. Got ${text.length}.`);
  }
  return text;
}

/** Upserts the agent brief for (caller, date), overwriting a built-in row. The database names the source from the token. */
export async function writeAgentBriefCore(supabase: SupabaseClient, input: { date: string; text: string; tokenId?: string }): Promise<void> {
  const { error } = await supabase.rpc("write_agent_morning_brief", { p_date: input.date, p_text: input.text, p_token_id: input.tokenId ?? null });
  if (error) throw error;
}

/** Deletes the caller's AGENT brief for the date (never a built-in one). Returns whether there was one. */
export async function clearAgentBriefCore(supabase: SupabaseClient, date: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("clear_agent_morning_brief", { p_date: date });
  if (error) throw error;
  return Number(data) > 0;
}
