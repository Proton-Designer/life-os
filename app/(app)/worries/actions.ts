"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";

/**
 * The Worry List's one write: flip a worry between open and handled.
 *
 * Reuses `tasks.completed`/`completed_at` (see `lib/night-plan/worries.ts`'s
 * header for why that is the right representation rather than new schema).
 * Both actions are scoped by `user_id` AND `dump_source = 'worry'` — the
 * second predicate is defense in depth, not just an optimization: this file
 * must never be able to mark an ordinary school/co_op task "handled" by
 * accident (e.g. a stale id from a different surface), and a worry is the
 * only kind of row that predicate admits.
 *
 * SET, NOT TOGGLE. A checkbox that flips whatever the row currently holds
 * races a double-tap into the wrong state; these two actions each assert the
 * state they mean rather than trusting the caller's belief about what the
 * row was before the tap.
 *
 * EXISTENCE IS CHECKED FIRST (same shape as `lib/tasks/actions-core.ts`'s
 * `toggleTaskCore`), so a stale/foreign id gets a clean "not found" instead
 * of a silent no-op update matching zero rows.
 */

async function findWorry(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, id: string) {
  const { data } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("dump_source", "worry")
    .maybeSingle();
  return data;
}

function revalidateWorrySurfaces() {
  revalidatePath("/worries");
  revalidatePath("/close");
  revalidatePath("/open");
  revalidatePath("/");
}

export async function markWorryHandled(id: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await requireUser();
  const existing = await findWorry(supabase, userId, id);
  if (!existing) return { error: "That worry could not be found." };

  const { error } = await supabase
    .from("tasks")
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidateWorrySurfaces();
  return { ok: true };
}

export async function reopenWorry(id: string): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await requireUser();
  const existing = await findWorry(supabase, userId, id);
  if (!existing) return { error: "That worry could not be found." };

  const { error } = await supabase
    .from("tasks")
    .update({ completed: false, completed_at: null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidateWorrySurfaces();
  return { ok: true };
}
