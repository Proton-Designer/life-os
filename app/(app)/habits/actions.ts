"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  createIdentityHabitCore,
  archiveIdentityHabitCore,
  killIdentityHabitCore,
  castHabitVoteCore,
  retractHabitVoteCore,
  pauseIdentityHabitCore,
  resumeIdentityHabitCore,
  type Habit,
} from "@/lib/habits/actions-core";

/**
 * "use server" wrappers over lib/habits/actions-core.ts (#39/#40) — same
 * shape as app/(app)/goals/actions.ts: `requireUser()` for the session,
 * Postgres errors mapped to a message a person can act on, `revalidatePath`
 * on every surface a write can change. Client components import these
 * functions directly (never receive them as a prop) — the RSC
 * function-prop hazard CLAUDE.md records.
 */

type ActionResult<T = { ok: true }> = T | { error: string };

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

function describeHabitError(err: unknown): string {
  if (isPgUniqueViolation(err)) {
    return "That slot was just taken — try again.";
  }
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

async function timezoneForUser(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string): Promise<string> {
  const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return profile?.timezone ?? "UTC";
}

function revalidateHabitSurfaces() {
  revalidatePath("/habits");
}

export async function createIdentityHabitAction(identityStatement: string): Promise<ActionResult<{ ok: true; habit: Habit }>> {
  const { supabase, userId } = await requireUser();
  try {
    const habit = await createIdentityHabitCore(supabase, userId, identityStatement);
    revalidateHabitSurfaces();
    return { ok: true, habit };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

export async function archiveIdentityHabitAction(habitId: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    await archiveIdentityHabitCore(supabase, userId, habitId);
    revalidateHabitSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

export type KillHabitActionResult = ActionResult<{ ok: true }> | { ok: false; reason: "requires_reason" };

/** P2-11 -- `reason` optional; killIdentityHabitCore re-checks server-side whether one was actually required, never trusting a client's own idea of the habit's vote count. */
export async function killIdentityHabitAction(habitId: string, reason?: string): Promise<KillHabitActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const result = await killIdentityHabitCore(supabase, userId, habitId, reason);
    if (!result.ok) return result;
    revalidateHabitSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

/**
 * `requestedDate` is what the caller believes is today — the real UI always
 * sends the server-computed `todayStr` the page rendered with (a plain
 * string prop, never a function). It is re-validated against the server's
 * OWN `now()`/timezone inside `castHabitVoteCore`, never trusted outright:
 * a request naming any other date is rejected there, not here, so this
 * wrapper carries no separate copy of that rule to drift out of sync.
 */
/** Data-free cache revalidation scheduled by the habit vote control after a burst of taps (PERF-2). */
export async function refreshHabitViews(): Promise<void> {
  await requireUser();
  revalidateHabitSurfaces();
}

export async function castHabitVoteAction(habitId: string, requestedDate: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const timezone = await timezoneForUser(supabase, userId);
    await castHabitVoteCore(supabase, userId, habitId, requestedDate, new Date(), timezone);
    // Hot tap: no revalidatePath here -- the client schedules ONE refreshHabitViews() per burst (PERF-2).
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

export async function retractHabitVoteAction(habitId: string, requestedDate: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const timezone = await timezoneForUser(supabase, userId);
    await retractHabitVoteCore(supabase, userId, habitId, requestedDate, new Date(), timezone);
    // Hot tap: no revalidatePath here -- the client schedules ONE refreshHabitViews() per burst (PERF-2).
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

/** P3-07 -- see actions-core.ts's own header on `pauseIdentityHabitCore` for the score-freeze reasoning and write ordering. */
export async function pauseIdentityHabitAction(habitId: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const timezone = await timezoneForUser(supabase, userId);
    await pauseIdentityHabitCore(supabase, userId, habitId, new Date(), timezone);
    revalidateHabitSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}

export async function resumeIdentityHabitAction(habitId: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const timezone = await timezoneForUser(supabase, userId);
    await resumeIdentityHabitCore(supabase, userId, habitId, new Date(), timezone);
    revalidateHabitSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: describeHabitError(err) };
  }
}
