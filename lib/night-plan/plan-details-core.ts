import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mirrorToKillListCore, normalizeKillListTitle } from "@/lib/night-plan/kill-list-mirror";
import { planLineEffects, validatePlanLine, type PlanLineInput } from "@/lib/night-plan/plan-details";

/**
 * Applies what the person chose for each plan line (domain, Kill List, start time, timer, order) and removes the
 * lines they dropped. Called by the plan stage's Finish and the Edit Plan dialog through the same Server Action.
 * The decisions live in plan-details.ts (pure, tested); this file only runs them. Shaped like every other core in
 * this repo -- `(supabase, userId, ...)`, no cookie/auth reads -- so a bearer-authed caller could share it.
 *
 * NOT ATOMIC, and honest about it: each line is its own UPDATE (PostgREST has no multi-row heterogeneous update),
 * run together. A failure part-way reports an error and the person can Finish again -- every write here is
 * idempotent (the same line applied twice lands in the same place; the Kill List mirror skips a title already on
 * the list; the Work Backlog entry fires only on the transition into Work).
 */

type PrevRow = { id: string; title: string; plan_area: string | null; domain: string | null; due_date: string | null; kill_list_item_id: string | null };

export type ApplyPlanDetailsResult = { killListOverflow: string[]; notices: string[] } | { error: string };

export async function applyPlanDetailsCore(
  supabase: SupabaseClient,
  userId: string,
  plannedDate: string,
  lines: readonly PlanLineInput[],
  opts: { killListAvailable: boolean },
): Promise<ApplyPlanDetailsResult> {
  if (lines.length === 0) return { killListOverflow: [], notices: [] };
  for (const line of lines) {
    const bad = validatePlanLine(line);
    if (bad) return { error: bad };
  }

  const { data: prevRows, error: prevError } = await supabase
    .from("tasks")
    .select("id, title, plan_area, domain, due_date, kill_list_item_id")
    .eq("user_id", userId)
    .eq("planned_date", plannedDate)
    .in("id", lines.map((l) => l.id));
  if (prevError) return { error: prevError.message };
  const prevById = new Map((prevRows ?? []).map((r) => [r.id as string, r as PrevRow]));
  const missing = lines.find((l) => !prevById.has(l.id));
  if (missing) return { error: "One of those lines is no longer on the plan. Reopen the plan and try again." };

  const effects = lines.map((line) => {
    const prev = prevById.get(line.id)!;
    return { line, prev, ...planLineEffects({ area: prev.plan_area, domain: prev.domain, dueDate: prev.due_date, killListItemId: prev.kill_list_item_id }, line, plannedDate) };
  });

  const notices: string[] = [];
  let killListOverflow: string[] = [];

  // Kill List first: the pairing id goes onto the same UPDATE as the rest of the line.
  const killIdByLine = new Map<string, string>();
  const wantTitles = effects.filter((e) => e.wantKillList && opts.killListAvailable).map((e) => e.prev.title);
  if (wantTitles.length > 0) {
    const mirrored = await mirrorToKillListCore(supabase, userId, plannedDate, wantTitles);
    if ("error" in mirrored) return { error: `Your plan wasn't saved: the Kill List didn't update (${mirrored.error}).` };
    killListOverflow = mirrored.overflow;
    for (const e of effects) {
      if (!e.wantKillList || !opts.killListAvailable) continue;
      const id = mirrored.idsByTitle.get(normalizeKillListTitle(e.prev.title));
      if (id) killIdByLine.set(e.line.id, id);
    }
  }

  // The row is the Kill List's own slot (completed, text, position): only ever remove one this plan paired and that is still open.
  const drops = effects.map((e) => e.dropKillListItemId).filter((id): id is string => id !== null);
  if (drops.length > 0) {
    const { error } = await supabase.from("kill_list_items").delete().in("id", drops).eq("user_id", userId).eq("completed", false);
    if (error) return { error: error.message };
  }

  // Work: the current target's Backlog, once per entry into Work.
  const workLines = effects.filter((e) => e.enterWorkBacklog);
  if (workLines.length > 0) {
    const { data: target, error } = await supabase.from("coop_targets").select("id").eq("user_id", userId).eq("status", "active").order("position", { ascending: true }).limit(1).maybeSingle();
    if (error) return { error: error.message };
    if (!target) {
      notices.push("You have no active Work target yet, so Work lines stayed on today's plan only.");
    } else {
      const { error: insertError } = await supabase.from("coop_tasks").insert(workLines.map((e) => ({ user_id: userId, target_id: target.id, title: e.prev.title, status: "backlog" })));
      if (insertError) return { error: insertError.message };
    }
  }

  const results = await Promise.all(
    effects.map((e) => {
      const patch = { ...e.patch };
      const killId = killIdByLine.get(e.line.id);
      if (killId) patch.kill_list_item_id = killId;
      return supabase.from("tasks").update(patch).eq("id", e.line.id).eq("user_id", userId).eq("planned_date", plannedDate);
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  return { killListOverflow, notices };
}

/**
 * Drops lines from a plan. A line the person TYPED is deleted; one that came from somewhere else -- a worry or a
 * parked capture -- is only taken off the plan (planned_date/rank/plan details cleared), so Edit Plan can never
 * delete a worry out of the Worries list. A paired Kill List row that is still open goes with the line (the line
 * was what put it there); a finished one stays as the record.
 */
export async function removePlanLinesCore(supabase: SupabaseClient, userId: string, plannedDate: string, ids: readonly string[]): Promise<{ ok: true } | { error: string }> {
  if (ids.length === 0) return { ok: true };
  const { data, error } = await supabase
    .from("tasks")
    .select("id, dump_source, plan_area, kill_list_item_id")
    .eq("user_id", userId)
    .eq("planned_date", plannedDate)
    .in("id", ids as string[]);
  if (error) return { error: error.message };
  const rows = data ?? [];

  const killIds = rows.map((r) => r.kill_list_item_id as string | null).filter((id): id is string => id !== null);
  if (killIds.length > 0) {
    const { error: killError } = await supabase.from("kill_list_items").delete().in("id", killIds).eq("user_id", userId).eq("completed", false);
    if (killError) return { error: killError.message };
  }

  const keep = rows.filter((r) => r.dump_source === "worry" || r.dump_source === "capture");
  const keepIds = new Set(keep.map((r) => r.id as string));
  const deleteIds = rows.map((r) => r.id as string).filter((id) => !keepIds.has(id));

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase.from("tasks").delete().in("id", deleteIds).eq("user_id", userId).eq("planned_date", plannedDate);
    if (deleteError) return { error: deleteError.message };
  }
  if (keep.length > 0) {
    // A School-attached worry was a School task only because of this plan: put that back too.
    const { error: unplanError } = await supabase
      .from("tasks")
      .update({ planned_date: null, mit_rank: null, plan_area: null, planned_start_time: null, planned_duration_minutes: null, plan_order: null, plan_criteria: null, timer_started_at: null, kill_list_item_id: null })
      .in("id", [...keepIds])
      .eq("user_id", userId);
    if (unplanError) return { error: unplanError.message };
    const schoolKept = keep.filter((r) => r.plan_area === "school").map((r) => r.id as string);
    if (schoolKept.length > 0) {
      const { error: schoolError } = await supabase.from("tasks").update({ domain: null, due_date: null }).in("id", schoolKept).eq("user_id", userId);
      if (schoolError) return { error: schoolError.message };
    }
  }
  return { ok: true };
}

/** Starts an inline timer on a task (idempotent: a timer already running keeps its original start). */
export async function startTaskTimerCore(supabase: SupabaseClient, userId: string, id: string, now: Date): Promise<{ startedAt: string }> {
  const { data: existing, error } = await supabase.from("tasks").select("timer_started_at").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!existing) throw new Error("Task not found");
  if (existing.timer_started_at) return { startedAt: existing.timer_started_at as string };
  const startedAt = now.toISOString();
  const { error: updateError } = await supabase.from("tasks").update({ timer_started_at: startedAt }).eq("id", id).eq("user_id", userId).is("timer_started_at", null);
  if (updateError) throw updateError;
  return { startedAt };
}

/**
 * SETS a plan line's completion and keeps its paired Kill List row in step (the pair is one decision shown in two
 * places). Completing also stops a running inline timer.
 */
export async function setPlanLineCompletedCore(supabase: SupabaseClient, userId: string, id: string, completed: boolean, now: Date): Promise<void> {
  const completedAt = completed ? now.toISOString() : null;
  const { data, error } = await supabase
    .from("tasks")
    .update(completed ? { completed, completed_at: completedAt, timer_started_at: null } : { completed, completed_at: null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, kill_list_item_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Task not found");
  const killId = data[0].kill_list_item_id as string | null;
  if (killId) {
    const { error: killError } = await supabase.from("kill_list_items").update({ completed, completed_at: completedAt }).eq("id", killId).eq("user_id", userId);
    if (killError) throw killError;
  }
}
