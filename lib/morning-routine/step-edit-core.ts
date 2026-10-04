import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/** The editable fields of a Launch-sequence step (IA-P4b). `null` clears an optional field; `undefined` leaves it alone. */
export type LaunchStepPatch = { label?: string; ifCue?: string | null; fallbackText?: string | null; habitId?: string | null };

function cleanOptional(v: string | null, field: string): string | null {
  const t = v?.trim();
  if (!t) return null;
  if (t.length > 80) throw new Error(`${field} can be at most 80 characters.`);
  return t;
}

/**
 * Edits one step in place (label / "when" cue / 2-minute version / linked habit). Same limits as
 * creation (label <= 120, cue and fallback <= 80, a linked habit must be one of YOUR active
 * identity habits). Re-asserts ownership + not-archived in the UPDATE and proves a row changed, so
 * a stale tap (step removed in another tab) is an error, not a silent no-op. Ticks and their
 * history are untouched. A new file (not actions-core.ts) so the P4a core stays as reviewed.
 */
export async function updateLaunchStepCore(supabase: TypedClient, userId: string, itemId: string, patch: LaunchStepPatch): Promise<void> {
  const update: Database["public"]["Tables"]["morning_routine_items"]["Update"] = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new Error("A step needs a label.");
    if (label.length > 120) throw new Error("A step can be at most 120 characters.");
    update.label = label;
  }
  if (patch.ifCue !== undefined) update.if_cue = cleanOptional(patch.ifCue, "The cue");
  if (patch.fallbackText !== undefined) update.fallback_text = cleanOptional(patch.fallbackText, "The 2-minute version");
  if (patch.habitId !== undefined) {
    if (patch.habitId !== null) {
      const { data: habit, error: habitError } = await supabase
        .from("identity_habits")
        .select("id")
        .eq("id", patch.habitId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (habitError) throw habitError;
      if (!habit) throw new Error("That habit isn't active, so a step can't count toward it.");
    }
    update.habit_id = patch.habitId;
  }
  if (Object.keys(update).length === 0) return;

  const { data, error } = await supabase
    .from("morning_routine_items")
    .update(update)
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("That step no longer exists.");
}
