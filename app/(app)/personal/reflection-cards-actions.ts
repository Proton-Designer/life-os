"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { hasOptInFeature } from "@/lib/opt-in-features";
import { createCardCore, archiveCardCore, listActiveCardsCore, pickNextCardForUserCore, submitReflectionCore, type CreateCardResult, type SimpleResult, type SubmitReflectionResult } from "@/lib/reflection-cards/actions-core";
import { computeHourRecapCore } from "@/lib/reflection-cards/end-of-hour-core";
import type { HourRecap, HourWorkInterval, ReflectionCard } from "@/lib/reflection-cards/types";

/**
 * P3-05 -- thin Server Action wrappers, all gated server-side on
 * `enabled_features` containing `cards_library`, never trusting the client
 * to have honestly hidden the UI (same "never trust the client" posture
 * every flagged/gated surface in this codebase uses). The UI component
 * itself also checks the flag before ever rendering the trigger -- this is
 * the second, authoritative gate, not the only one.
 */
const NOT_ENABLED: SimpleResult = { ok: false, message: "The cards library isn't turned on. Enable it in Settings first." };

async function requireCardsLibraryEnabled(): Promise<{ supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]; userId: string } | null> {
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  if (!hasOptInFeature(profile?.enabled_features, "cards_library")) return null;
  return { supabase, userId };
}

export async function createReflectionCard(kind: string, content: string): Promise<CreateCardResult> {
  const ctx = await requireCardsLibraryEnabled();
  if (!ctx) return NOT_ENABLED;
  const result = await createCardCore(ctx.supabase, ctx.userId, kind, content);
  if (result.ok) revalidatePath("/self-mastery");
  return result;
}

export async function archiveReflectionCard(cardId: string): Promise<SimpleResult> {
  const ctx = await requireCardsLibraryEnabled();
  if (!ctx) return NOT_ENABLED;
  const result = await archiveCardCore(ctx.supabase, ctx.userId, cardId);
  if (result.ok) revalidatePath("/self-mastery");
  return result;
}

export async function listMyReflectionCards(): Promise<ReflectionCard[]> {
  const ctx = await requireCardsLibraryEnabled();
  if (!ctx) return [];
  return listActiveCardsCore(ctx.supabase, ctx.userId);
}

export interface EndOfHourRecapResult {
  ok: boolean;
  message: string;
  recap?: HourRecap;
  card?: ReflectionCard | null;
}

/**
 * P3-05 -- recap step of the ritual: `intervals` is already-fetched, real
 * work-session data for the last 60 minutes (the caller's own concern, not
 * this action's -- this action only summarizes+picks, matching
 * end-of-hour-core.ts's own pure-function split).
 */
export async function startEndOfHourRitual(intervals: HourWorkInterval[]): Promise<EndOfHourRecapResult> {
  const ctx = await requireCardsLibraryEnabled();
  if (!ctx) return NOT_ENABLED;
  const recap = computeHourRecapCore(intervals);
  const { card } = await pickNextCardForUserCore(ctx.supabase, ctx.userId);
  return { ok: true, message: "Ready.", recap, card };
}

export async function submitEndOfHourReflection(cardId: string, response: string | null): Promise<SubmitReflectionResult> {
  const ctx = await requireCardsLibraryEnabled();
  if (!ctx) return NOT_ENABLED;
  const result = await submitReflectionCore(ctx.supabase, ctx.userId, cardId, response);
  if (result.ok) revalidatePath("/self-mastery");
  return result;
}
