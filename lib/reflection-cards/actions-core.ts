import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReflectionCardKind, type ReflectionCard, type ReflectionCardKind } from "@/lib/reflection-cards/types";
import { pickNextCardCore } from "@/lib/reflection-cards/end-of-hour-core";

/**
 * P3-05 -- DB-touching half of the cards library + End-of-Hour ritual.
 * `core(supabase, userId, ...)` extraction, same rule as every other core
 * file tonight: never calls `requireUser()`/`getProfile()` itself, so the
 * MCP write path can reuse it identically to the Server Action wrapper.
 *
 * Archive-never-delete throughout (same convention as every other
 * user-authored library row this session): `archiveCardCore` only ever
 * sets `active = false`, and `listActiveCardsCore` filters at read, never
 * relying on a row having actually been removed.
 */

function toReflectionCard(row: Record<string, unknown>): ReflectionCard {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as ReflectionCardKind,
    content: row.content as string,
    active: row.active as boolean,
    lastShownAt: (row.last_shown_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export interface CreateCardResult {
  ok: boolean;
  message: string;
  card?: ReflectionCard;
}

export async function createCardCore(supabase: SupabaseClient, userId: string, kind: string, content: string): Promise<CreateCardResult> {
  if (!isReflectionCardKind(kind)) return { ok: false, message: `Unknown card kind: "${kind}".` };
  const trimmed = content.trim();
  if (trimmed.length === 0) return { ok: false, message: "A card needs some content." };

  const { data, error } = await supabase.from("reflection_cards").insert({ user_id: userId, kind, content: trimmed }).select().single();
  if (error || !data) return { ok: false, message: "Couldn't create that card. Try again." };
  return { ok: true, message: "Card created.", card: toReflectionCard(data) };
}

export interface SimpleResult {
  ok: boolean;
  message: string;
}

/** Never a hard delete -- same archive-only convention as every other library table tonight. Scoped by user_id in the WHERE, not just RLS, so a wrong id for another user's card is a real 0-row no-op, not an RLS-caught error. */
export async function archiveCardCore(supabase: SupabaseClient, userId: string, cardId: string): Promise<SimpleResult> {
  const { data, error } = await supabase.from("reflection_cards").update({ active: false }).eq("id", cardId).eq("user_id", userId).select("id").maybeSingle();
  if (error) return { ok: false, message: "Couldn't archive that card. Try again." };
  if (!data) return { ok: false, message: "Card not found." };
  return { ok: true, message: "Archived." };
}

export async function listActiveCardsCore(supabase: SupabaseClient, userId: string): Promise<ReflectionCard[]> {
  const { data, error } = await supabase.from("reflection_cards").select().eq("user_id", userId).eq("active", true);
  if (error || !data) return [];
  return data.map(toReflectionCard);
}

export interface NextCardResult {
  card: ReflectionCard | null;
}

/** Thin wrapper: fetches this user's active cards, then hands them to the pure `pickNextCardCore` (oldest-`lastShownAt`-first, never-shown counts as oldest). */
export async function pickNextCardForUserCore(supabase: SupabaseClient, userId: string): Promise<NextCardResult> {
  const cards = await listActiveCardsCore(supabase, userId);
  return { card: pickNextCardCore(cards) };
}

export interface SubmitReflectionResult {
  ok: boolean;
  message: string;
}

/**
 * Logs the reflection (append-only -- `end_of_hour_reflections` has no
 * update/delete policy, a historical record) and stamps `last_shown_at` on
 * the card so the next rotation correctly treats it as freshly shown, not
 * still-oldest. Both writes scoped by `user_id` explicitly, not just RLS.
 */
export async function submitReflectionCore(supabase: SupabaseClient, userId: string, cardId: string, response: string | null): Promise<SubmitReflectionResult> {
  const { data: card, error: cardError } = await supabase.from("reflection_cards").select("id").eq("id", cardId).eq("user_id", userId).eq("active", true).maybeSingle();
  if (cardError || !card) return { ok: false, message: "That card is no longer available." };

  const trimmedResponse = response?.trim() || null;
  const { error: insertError } = await supabase.from("end_of_hour_reflections").insert({ user_id: userId, card_id: cardId, response: trimmedResponse });
  if (insertError) return { ok: false, message: "Couldn't log that reflection. Try again." };

  const { error: stampError } = await supabase.from("reflection_cards").update({ last_shown_at: new Date().toISOString() }).eq("id", cardId).eq("user_id", userId);
  if (stampError) return { ok: false, message: "Logged, but couldn't update the card's rotation. Try again next time." };

  return { ok: true, message: "Logged." };
}
