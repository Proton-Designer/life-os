import type { SupabaseClient } from "@supabase/supabase-js";
import { ToolInputError } from "@/lib/mcp/tool-input-error";

/**
 * A "connect this lesson to today" line written by an agent through the connector (migration 276), for a person with no AI key.
 * The line is stored per (card, local day); the session closer reads it before it tries to generate one. One sentence, 1..220
 * characters (the cap lib/self-mastery/closer-day-connection.ts's normalizer already uses).
 */
export const DAY_CONNECTION_MAX_CHARS = 220;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCardId(raw: unknown): string {
  if (typeof raw !== "string" || !UUID.test(raw)) throw new ToolInputError(`patch.card_id is required and must be a lesson card id. Got: ${JSON.stringify(raw)}.`);
  return raw;
}

export function parseDayConnectionText(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) throw new ToolInputError("patch.text is required and must be a non-empty string.");
  const text = raw.trim();
  if (/[\r\n]/.test(text)) throw new ToolInputError("patch.text must be one line (one short sentence).");
  if (text.length > DAY_CONNECTION_MAX_CHARS) throw new ToolInputError(`patch.text must be at most ${DAY_CONNECTION_MAX_CHARS} characters. Got ${text.length}.`);
  return text;
}

/** Returns false when the card is not the caller's own (the function wrote nothing). */
export async function writeAgentDayConnectionCore(supabase: SupabaseClient, input: { cardId: string; date: string; text: string; tokenId?: string }): Promise<boolean> {
  const { data, error } = await supabase.rpc("write_agent_day_connection", { p_card_id: input.cardId, p_date: input.date, p_text: input.text, p_token_id: input.tokenId ?? null });
  if (error) throw error;
  return Number(data) > 0;
}

export async function clearAgentDayConnectionCore(supabase: SupabaseClient, cardId: string, date: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("clear_agent_day_connection", { p_card_id: cardId, p_date: date });
  if (error) throw error;
  return Number(data) > 0;
}
