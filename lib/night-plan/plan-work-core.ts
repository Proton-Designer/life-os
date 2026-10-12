import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { endWorkSessionCore } from "@/lib/business/actions-core";

/**
 * Pause / Resume for a plan line (Package E): banking worked time into `tasks.timer_elapsed_seconds` (migration 262) and
 * the link between a plan line and the Deep Work / Deep Study session that is working on it. Shaped like every other core
 * here, `(supabase, userId, ...)`, no cookie/auth reads, so the Server Actions and the MCP end-session op share it.
 *
 * Two rules everything below follows:
 *   - Time is only ever banked from SERVER-recorded instants (tasks.timer_started_at, work_sessions.started_at/ended_at),
 *     never a client clock.
 *   - Banking is IDEMPOTENT: it happens only when the call is the one that actually closed the stretch (a guarded UPDATE
 *     on timer_started_at; `endWorkSessionCore` returning true), so a double tap or a retry banks nothing twice.
 */

const seconds = (fromIso: string, toMs: number) => Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));

/** Adds `delta` seconds to a line's bank (read-modify-write, guarded on the value read; retried once on a lost race). */
export async function bankSecondsCore(supabase: SupabaseClient, userId: string, taskId: string, delta: number): Promise<number> {
  if (delta <= 0) return 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from("tasks").select("timer_elapsed_seconds").eq("id", taskId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Task not found");
    const prior = (data.timer_elapsed_seconds as number | null) ?? 0;
    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update({ timer_elapsed_seconds: prior + delta })
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("timer_elapsed_seconds", prior)
      .select("id");
    if (updateError) throw updateError;
    if (updated && updated.length > 0) return prior + delta;
  }
  throw new Error("Couldn't save the time. Try again.");
}

/**
 * Pauses a running INLINE timer: banks `now - timer_started_at` and clears timer_started_at in ONE guarded UPDATE
 * (`where timer_started_at = <the value read>`), so two taps cannot both bank. Not running = a no-op that just reports
 * what is banked. Returns the total banked after the call and whether THIS call banked a stretch.
 */
export async function pauseTaskTimerCore(supabase: SupabaseClient, userId: string, taskId: string, now: Date): Promise<{ elapsedSeconds: number; paused: boolean }> {
  const { data, error } = await supabase.from("tasks").select("timer_started_at, timer_elapsed_seconds").eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task not found");
  const startedAt = data.timer_started_at as string | null;
  const banked = (data.timer_elapsed_seconds as number | null) ?? 0;
  if (!startedAt) return { elapsedSeconds: banked, paused: false };

  const total = banked + seconds(startedAt, now.getTime());
  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update({ timer_started_at: null, timer_elapsed_seconds: total })
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq("timer_started_at", startedAt)
    .select("id");
  if (updateError) throw updateError;
  if (updated && updated.length > 0) return { elapsedSeconds: total, paused: true };
  // Lost the race: another call already paused it. Report what it banked; bank nothing again.
  const { data: again } = await supabase.from("tasks").select("timer_elapsed_seconds").eq("id", taskId).eq("user_id", userId).maybeSingle();
  return { elapsedSeconds: ((again?.timer_elapsed_seconds as number | null | undefined) ?? banked), paused: false };
}

type ObjectiveRow = { kind: string; task_id: string | null; kill_list_item_id: string | null };

/** The ACTIVE Deep Work / Deep Study session working on this plan line (a task objective, or the line's paired Kill List objective), or null. */
export async function activeSessionForTaskCore(supabase: SupabaseClient, userId: string, task: { id: string; kill_list_item_id: string | null }): Promise<string | null> {
  const { data: session, error } = await supabase.from("work_sessions").select("id").eq("user_id", userId).is("ended_at", null).eq("counts_toward_hours", true).maybeSingle();
  if (error) throw error;
  if (!session) return null;
  const { data: objectives, error: objError } = await supabase.from("work_session_objectives").select("kind, task_id, kill_list_item_id").eq("session_id", session.id);
  if (objError) throw objError;
  const linked = ((objectives ?? []) as ObjectiveRow[]).some((o) => (o.kind === "task" && o.task_id === task.id) || (o.kind === "kill_list_item" && task.kill_list_item_id !== null && o.kill_list_item_id === task.kill_list_item_id));
  return linked ? (session.id as string) : null;
}

/**
 * The plan line a session is working on, or null: exactly ONE plan task (a task with `planned_date`) among its objectives,
 * counting a paired Kill List objective through `tasks.kill_list_item_id`. A session with several plan tasks (or none) is
 * not "a plan line's session": nothing is banked for it and the overlay keeps its normal End Session.
 */
export async function planTaskIdForSessionCore(supabase: SupabaseClient, userId: string, sessionId: string): Promise<string | null> {
  const { data: objectives, error } = await supabase.from("work_session_objectives").select("kind, task_id, kill_list_item_id").eq("session_id", sessionId);
  if (error) throw error;
  const rows = (objectives ?? []) as ObjectiveRow[];
  const taskIds = rows.filter((o) => o.kind === "task" && o.task_id).map((o) => o.task_id as string);
  const killIds = rows.filter((o) => o.kind === "kill_list_item" && o.kill_list_item_id).map((o) => o.kill_list_item_id as string);
  if (taskIds.length === 0 && killIds.length === 0) return null;
  const found = new Set<string>();
  if (taskIds.length > 0) {
    const { data, error: e } = await supabase.from("tasks").select("id").eq("user_id", userId).in("id", taskIds).not("planned_date", "is", null);
    if (e) throw e;
    for (const r of data ?? []) found.add(r.id as string);
  }
  if (killIds.length > 0) {
    const { data, error: e } = await supabase.from("tasks").select("id").eq("user_id", userId).in("kill_list_item_id", killIds).not("planned_date", "is", null);
    if (e) throw e;
    for (const r of data ?? []) found.add(r.id as string);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Ends a Deep Work / Deep Study session through the SAME core End Session uses (hours, reflection and the session record
 * are untouched), and -- only when this call is the one that ended it -- banks the DB-recorded duration (ended_at -
 * started_at, read back from the row) into the plan line it was working on. Used by EVERY way a session ends (End
 * Session, the goal-reached and all-objectives auto-ends, Pause, Mark Done, the MCP end op), so the time is never lost.
 */
export async function endSessionAndBankCore(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  endedAtIso?: string,
  /** The caller already KNOWS which plan line the session works on (Pause / Mark Done pressed on that line): skips the lookup, saving round trips on a hot tap. */
  knownTaskId?: string,
): Promise<{ ended: boolean; bankedSeconds: number; taskId: string | null; elapsedSeconds: number | null }> {
  const endedHere = await endWorkSessionCore(supabase, userId, sessionId, endedAtIso);
  if (!endedHere) return { ended: false, bankedSeconds: 0, taskId: null, elapsedSeconds: null };
  const taskId = knownTaskId ?? (await planTaskIdForSessionCore(supabase, userId, sessionId));
  if (!taskId) return { ended: true, bankedSeconds: 0, taskId: null, elapsedSeconds: null };
  const { data: row, error } = await supabase.from("work_sessions").select("started_at, ended_at").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!row?.started_at || !row.ended_at) return { ended: true, bankedSeconds: 0, taskId, elapsedSeconds: null };
  const bankedSeconds = seconds(row.started_at as string, new Date(row.ended_at as string).getTime());
  const elapsedSeconds = await bankSecondsCore(supabase, userId, taskId, bankedSeconds);
  return { ended: true, bankedSeconds, taskId, elapsedSeconds };
}

/** Marks a just-ended session as PAUSED (paused_at = its ended_at), so Resume re-opens this row instead of starting another. */
export async function markSessionPausedCore(supabase: SupabaseClient, userId: string, sessionId: string): Promise<void> {
  const { data, error } = await supabase.from("work_sessions").select("ended_at").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data?.ended_at) return;
  const { error: updateError } = await supabase.from("work_sessions").update({ paused_at: data.ended_at }).eq("id", sessionId).eq("user_id", userId).not("ended_at", "is", null);
  if (updateError) throw updateError;
}

/**
 * RESUME of a paused plan-line session: re-opens the SAME work_sessions row. ended_at is cleared and started_at moves forward by
 * the time spent paused, so every reader that computes (ended_at - started_at) or (now - started_at) keeps getting ACTIVE time
 * (the goal countdown, hours, the overlay's clock) and the original start is kept in original_started_at. The plan line's bank
 * held this session's earlier stretches, and the running session now counts them itself, so they are taken out of the bank
 * (the next pause banks the whole session again): nothing is counted twice.
 *
 * Returns the re-opened session's id, or null when there is no paused session for this line (the caller then starts a new one).
 * Throws "already active" when another session is running. Guarded on the paused marker, so a double tap resumes once.
 */
export async function resumePausedSessionCore(supabase: SupabaseClient, userId: string, task: { id: string; kill_list_item_id: string | null }, now: Date): Promise<string | null> {
  const { data: candidates, error } = await supabase
    .from("work_sessions")
    .select("id, started_at, ended_at, original_started_at")
    .eq("user_id", userId)
    .eq("counts_toward_hours", true)
    .not("paused_at", "is", null)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  for (const c of (candidates ?? []) as { id: string; started_at: string; ended_at: string; original_started_at: string | null }[]) {
    const { data: objectives, error: objError } = await supabase.from("work_session_objectives").select("kind, task_id, kill_list_item_id").eq("session_id", c.id);
    if (objError) throw objError;
    const linked = ((objectives ?? []) as ObjectiveRow[]).some((o) => (o.kind === "task" && o.task_id === task.id) || (o.kind === "kill_list_item" && task.kill_list_item_id !== null && o.kill_list_item_id === task.kill_list_item_id));
    if (!linked) continue;

    const { data: active } = await supabase.from("work_sessions").select("id").eq("user_id", userId).is("ended_at", null).eq("counts_toward_hours", true).maybeSingle();
    if (active) throw new Error("A work session is already active");

    const startedMs = new Date(c.started_at).getTime();
    const endedMs = new Date(c.ended_at).getTime();
    const gapMs = Math.max(0, now.getTime() - endedMs);
    const { data: reopened, error: updateError } = await supabase
      .from("work_sessions")
      .update({ ended_at: null, paused_at: null, started_at: new Date(startedMs + gapMs).toISOString(), original_started_at: c.original_started_at ?? c.started_at })
      .eq("id", c.id)
      .eq("user_id", userId)
      .eq("ended_at", c.ended_at)
      .not("paused_at", "is", null)
      .select("id");
    if (updateError) throw updateError;
    if (!reopened || reopened.length === 0) return null; // another tap resumed it first
    const activeSeconds = Math.max(0, Math.floor((endedMs - startedMs) / 1000));
    await unbankSecondsCore(supabase, userId, task.id, activeSeconds);
    return c.id;
  }
  return null;
}

/** Takes `delta` seconds back out of a line's bank (never below 0). */
async function unbankSecondsCore(supabase: SupabaseClient, userId: string, taskId: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from("tasks").select("timer_elapsed_seconds").eq("id", taskId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) return;
    const prior = (data.timer_elapsed_seconds as number | null) ?? 0;
    const { data: updated, error: updateError } = await supabase.from("tasks").update({ timer_elapsed_seconds: Math.max(0, prior - delta) }).eq("id", taskId).eq("user_id", userId).eq("timer_elapsed_seconds", prior).select("id");
    if (updateError) throw updateError;
    if (updated && updated.length > 0) return;
  }
}

/**
 * Before a plan line is marked done from any state: bank a running inline stretch and end (and bank) a running session
 * working on it. Completion itself stays `setPlanLineCompletedCore`.
 */
export async function settleTaskWorkCore(supabase: SupabaseClient, userId: string, taskId: string, now: Date): Promise<{ sessionEnded: boolean }> {
  const { data: task, error } = await supabase.from("tasks").select("id, kill_list_item_id").eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!task) throw new Error("Task not found");
  const sessionId = await activeSessionForTaskCore(supabase, userId, { id: task.id as string, kill_list_item_id: (task.kill_list_item_id as string | null) ?? null });
  const ended = sessionId ? (await endSessionAndBankCore(supabase, userId, sessionId, undefined, taskId)).ended : false;
  await pauseTaskTimerCore(supabase, userId, taskId, now);
  return { sessionEnded: ended };
}
