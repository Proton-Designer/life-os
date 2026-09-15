import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveTokenById } from "./tokens";
import { isUserActive } from "./active-user";
import { writeAuditRow } from "./audit";
import { runMcpTool, type RunMcpToolOutcome } from "./tool-wrapper";
import { writeTool, resolveWriteOperation, type WriteArgs } from "./tools/write";
import { sendScheduledNotificationCore } from "@/lib/notifications/notify-core";
import { computeNextRunAt } from "@/lib/scheduling/cron";
import type { AuthInfoLike } from "./auth-info";

/**
 * L7's background runner — invoked by app/api/cron/scheduled-actions/route.ts,
 * itself invoked by a pg_cron + pg_net poll (the SAME proven idiom driving
 * production's `dispatch-notifications-every-15min`).
 *
 * REQUIREMENT #1 (non-negotiable, team-lead): "A scheduled action runs
 * through the identical code path and the identical audit logging as a
 * live call. Not a parallel executor." Enforced structurally, not by
 * convention: every ACTUAL write dispatch below goes through
 * `runMcpTool(...)` calling `writeTool(...)` — the exact same two
 * functions `app/api/mcp/route.ts`'s live `write` tool calls. This file
 * never touches `write-registry.ts`'s handlers or a domain table directly.
 *
 * `notify` (a reminder) is dispatched through the SAME `runMcpTool` too —
 * same scope check, same audit logging — but there is no LIVE synchronous
 * "notify" tool for it to be identical to; the lead's ruling scoped this to
 * scheduled reminders only, never a live push-right-now tool, so "identical
 * code path" for notify means "goes through the one shared audit/scope
 * wrapper every tool uses," not "mirrors a twin live call that doesn't
 * exist." ONE NECESSARY DEVIATION, stated plainly: `sendScheduledNotificationCore`
 * needs `get_vault_secrets` (lib/notifications/send-push.ts), which is
 * GRANTED TO service_role ONLY (checked directly in the migration SQL, not
 * assumed) — the per-user RLS-scoped client `runMcpTool` normally hands a
 * tool's `fn` cannot call it. The notify dispatch closure below uses the
 * SERVICE-ROLE client already in scope here instead of the `userClient`
 * argument `runMcpTool` offers it, for that one reason.
 *
 * THE OTHER NECESSARY EXCEPTION: when a token turns out to be revoked, or
 * its user inactive, there is no live auth to hand `runMcpTool` at all —
 * its very first line is `readMcpAuth(authInfo)`, and a `null`/absent
 * `AuthInfoLike` makes it return silently with NO audit row (correct for
 * its real caller, route.ts, where that shape only happens if
 * `withMcpAuth` already failed to reject an unauthenticated request — a
 * "should never happen" case, not a normal denial). Constructing a FAKE
 * AuthInfoLike just to force that path would produce an audited call under
 * a scope the token doesn't actually have. So THESE TWO CHECKS run BEFORE
 * `runMcpTool`, mirroring route.ts's own real auth chain
 * (verifyAccessToken -> isUserActive -> mint session) one level up, and on
 * a denial write the audit row directly with the SAME `writeAuditRow`
 * primitive `runMcpTool` itself calls internally — not a second audit
 * mechanism, the identical one, used from the one place it structurally
 * has to be used a level higher.
 *
 * REQUIREMENT #2: the token's live scope/revocation state is looked up
 * FRESH via `getLiveTokenById` on every single firing — never cached from
 * schedule-creation time, never read off the stored row.
 *
 * REQUIREMENT #3 (bounded retry): a WRITE's consecutive-failure streak
 * past `MAX_CONSECUTIVE_FAILURES` PAUSES the row rather than retrying
 * forever — a runaway loop against a write surface is this program's
 * worst failure mode. A DENIAL (revoked token, inactive user) pauses
 * IMMEDIATELY, without burning through the failure budget first — a
 * denial is not a transient condition; it will not resolve itself by
 * trying again in 5 minutes the way a real transient error (a dropped
 * connection, a brief DB hiccup) might.
 *
 * A NOTIFY DELIVERY FAILURE IS DELIBERATELY A DIFFERENT POLICY, per the
 * lead's own instinct ("shouldn't pause a recurring reminder forever
 * because his phone was off") which this runner's own retry-code reading
 * confirmed is the right call: a push failure has NO write-surface risk —
 * nothing is corrupted by failing to deliver a notification repeatedly,
 * unlike a runaway write loop. So a RECURRING notify's delivery failure
 * NEVER pauses the schedule; it just proceeds to the next natural
 * occurrence (no short retry-soon either — retrying a push 5 minutes
 * later rarely helps and a recurring reminder gets a fresh chance
 * tomorrow regardless). A ONE-OFF notify's delivery failure DOES get a
 * few short retries (the moment hasn't fully passed yet) up to
 * `NOTIFY_ONE_OFF_MAX_DELIVERY_ATTEMPTS`, then is marked `cancelled` (not
 * `paused` — there is nothing to resume, the reminder's moment is gone)
 * with `last_outcome: 'error'` so it stays honestly visible via
 * `scheduler_manage("list")`, never silently swept to "done."
 *
 * `MAX_CONSECUTIVE_FAILURES`, `NOTIFY_ONE_OFF_MAX_DELIVERY_ATTEMPTS`, and
 * `ONE_OFF_RETRY_DELAY_MS` below are MINE, not specified — same posture
 * rate-limit.ts's own defaults take: placeholders the owner/lead should
 * revisit once real scheduled-action traffic exists, not researched
 * constants.
 *
 * REQUIREMENT #4 (at-least-once, so writes must tolerate running twice):
 * `claimDueActions`'s own comment explains the concrete mechanism (an
 * atomic claim-via-bump UPDATE) and the honest gap it leaves (a crash
 * between claim and finalize). This runner does NOT filter which actions
 * it will fire by idempotency — that gate is entirely at SCHEDULE time
 * (`createScheduledActionCore` refuses any WRITE not marked
 * `idempotent: true` in write-registry.ts; a notify's own idempotency
 * comes from lib/notifications/notify-core.ts's dispatch-log check, not
 * this gate). By the time a row reaches this runner, it was already only
 * ever allowed to be created if it's safe to run more than once.
 */

export const MAX_CONSECUTIVE_FAILURES = 5;
export const NOTIFY_ONE_OFF_MAX_DELIVERY_ATTEMPTS = 3;
const ONE_OFF_RETRY_DELAY_MS = 5 * 60 * 1000;
/** How long a claim's temporary bump holds before a crashed run's row becomes due again on its own — the self-healing half of "at-least-once," not a tunable retry interval. */
const CLAIM_BUFFER_MS = 10 * 60 * 1000;

interface ScheduledActionRow {
  id: string;
  user_id: string;
  token_id: string;
  tool_name: "write" | "notify";
  args: WriteArgs | { title: string; body: string };
  cron_expression: string | null;
  run_at: string | null;
  attempt_count: number;
}

/**
 * Atomically claims every currently-due row — an UPDATE that bumps
 * `next_run_at` forward by `CLAIM_BUFFER_MS` as part of the SAME statement
 * that selects them, so a second, truly-concurrent poll invocation's
 * identical UPDATE (same WHERE clause) can no longer match a row the
 * first one already claimed; Postgres's own per-row locking during an
 * UPDATE is what makes this atomic, not application-level coordination.
 *
 * THE GAP THIS LEAVES, HONESTLY: a crash between this claim and
 * `finalizeRun` below leaves the row's `next_run_at` at the temporary
 * bump — it becomes due again, and fires again, once that buffer elapses.
 * This is exactly why requirement #4 (writes must tolerate running twice)
 * is non-negotiable rather than an edge case to eliminate; it cannot be
 * eliminated without a distributed transaction spanning this process and
 * the poll's next invocation, which does not exist.
 */
export async function claimDueActions(serviceClient: SupabaseClient, now: Date): Promise<ScheduledActionRow[]> {
  const nowIso = now.toISOString();
  const claimedUntil = new Date(now.getTime() + CLAIM_BUFFER_MS).toISOString();
  const { data, error } = await serviceClient
    .from("mcp_scheduled_actions")
    .update({ next_run_at: claimedUntil })
    .eq("status", "active")
    .lte("next_run_at", nowIso)
    .select("id, user_id, token_id, tool_name, args, cron_expression, run_at, attempt_count");
  if (error) throw error;
  return (data ?? []) as ScheduledActionRow[];
}

interface FinalizeInput {
  status: "active" | "paused" | "cancelled";
  nextRunAt: string;
  lastOutcome: "ok" | "error" | "denied";
  lastError: string | null;
  attemptCount: number;
}

async function finalizeRun(serviceClient: SupabaseClient, id: string, now: Date, input: FinalizeInput): Promise<void> {
  const { error } = await serviceClient
    .from("mcp_scheduled_actions")
    .update({
      status: input.status,
      next_run_at: input.nextRunAt,
      last_run_at: now.toISOString(),
      last_outcome: input.lastOutcome,
      last_error: input.lastError,
      attempt_count: input.attemptCount,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Fetches just the timezone this one row's owner needs to advance a recurring schedule (or compute a notify's local dispatch-log date) — a per-row lookup, not threaded from anywhere, since a poll batch can span many different users. */
async function fetchTimezoneForUser(serviceClient: SupabaseClient, userId: string): Promise<string> {
  const { data } = await serviceClient.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "UTC";
}

/** The stored row's token_id right now (not the batch's claimed copy). Null on any read failure — the caller then denies exactly as before. */
async function fetchCurrentTokenId(serviceClient: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await serviceClient.from("mcp_scheduled_actions").select("token_id").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const tokenId = (data as { token_id?: unknown }).token_id;
  return typeof tokenId === "string" ? tokenId : null;
}

function resolveOperation(row: ScheduledActionRow): string {
  return row.tool_name === "notify" ? "notify.send" : resolveWriteOperation(row.args as WriteArgs);
}

async function denyRow(serviceClient: SupabaseClient, row: ScheduledActionRow, now: Date, reason: string): Promise<void> {
  // Same audit primitive runMcpTool itself calls internally -- see this
  // file's own header for why this is the one necessary exception to
  // "always dispatch through runMcpTool."
  await writeAuditRow(serviceClient, {
    userId: row.user_id,
    tokenId: row.token_id,
    toolName: row.tool_name,
    operation: resolveOperation(row),
    args: row.args,
    outcome: "denied",
    resultSummary: reason,
  });
  // A denial pauses IMMEDIATELY -- not a transient condition, see header.
  await finalizeRun(serviceClient, row.id, now, {
    status: "paused",
    nextRunAt: now.toISOString(),
    lastOutcome: "denied",
    lastError: reason,
    attemptCount: row.attempt_count + 1,
  });
}

/**
 * The notify `fn` handed to `runMcpTool` — closes over `serviceClient`
 * rather than using the `userClient` argument `runMcpTool` offers, for
 * the Vault-RPC reason this file's own header names. THROWS on a genuine
 * delivery failure (0 devices reached, whether from zero subscriptions or
 * every send failing) so `runMcpTool` reports/audits it as a real error —
 * this runner's OWN post-processing below is what then applies the
 * separate, more lenient notify-failure policy, not this function.
 */
async function dispatchNotify(serviceClient: SupabaseClient, row: ScheduledActionRow, timezone: string, now: Date): Promise<RunMcpToolOutcome> {
  const args = row.args as { title: string; body: string };
  const result = await sendScheduledNotificationCore(serviceClient, row.user_id, timezone, now, row.id, args.title, args.body);
  if (result.delivered === 0 && !result.alreadySent) {
    throw new Error("Push delivery failed -- no device received it (expired/unregistered subscription, or none at all).");
  }
  return {
    result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } },
    summary: result.alreadySent ? "notification already sent for this occurrence, skipped" : `delivered to ${result.delivered}/${result.total} device(s)`,
  };
}

/** Advances a successful row to its next state: cancelled (one-off, done) or active with a recomputed next_run_at (recurring), resetting the failure streak to 0 either way. */
async function finalizeSuccess(serviceClient: SupabaseClient, row: ScheduledActionRow, now: Date): Promise<void> {
  if (row.run_at) {
    // One-off: done. "cancelled" and "will never fire again because it
    // succeeded" are the same fact `status` needs to carry -- see the
    // migration draft's own header on why there's no separate "completed".
    await finalizeRun(serviceClient, row.id, now, { status: "cancelled", nextRunAt: now.toISOString(), lastOutcome: "ok", lastError: null, attemptCount: 0 });
    return;
  }
  const timezone = await fetchTimezoneForUser(serviceClient, row.user_id);
  const nextRunAt = computeNextRunAt(row.cron_expression as string, now, timezone);
  await finalizeRun(serviceClient, row.id, now, { status: "active", nextRunAt: nextRunAt.toISOString(), lastOutcome: "ok", lastError: null, attemptCount: 0 });
}

/** WRITE failure policy: bounded consecutive retries, then pause. See this file's header, requirement #3. */
async function finalizeWriteFailure(serviceClient: SupabaseClient, row: ScheduledActionRow, now: Date, errorText: string | null): Promise<void> {
  const attemptCount = row.attempt_count + 1;
  if (attemptCount >= MAX_CONSECUTIVE_FAILURES) {
    await finalizeRun(serviceClient, row.id, now, { status: "paused", nextRunAt: now.toISOString(), lastOutcome: "error", lastError: errorText, attemptCount });
  } else {
    // Retry soon, not at the schedule's own next natural occurrence -- a
    // one-off has no "next occurrence" at all, and a recurring action's
    // real cadence could be a day or a week away, far too slow to recover
    // from a transient failure within its own bounded-retry budget.
    const nextRunAt = new Date(now.getTime() + ONE_OFF_RETRY_DELAY_MS);
    await finalizeRun(serviceClient, row.id, now, { status: "active", nextRunAt: nextRunAt.toISOString(), lastOutcome: "error", lastError: errorText, attemptCount });
  }
}

/** NOTIFY delivery-failure policy: deliberately NOT the write policy — see this file's header, requirement #3's notify carve-out. */
async function finalizeNotifyFailure(serviceClient: SupabaseClient, row: ScheduledActionRow, now: Date, errorText: string | null): Promise<void> {
  if (row.run_at) {
    // One-off: a short, bounded retry budget of its own (the moment
    // hasn't fully passed yet), then cancelled -- never paused, there is
    // nothing left to resume once its window has passed.
    const attemptCount = row.attempt_count + 1;
    if (attemptCount >= NOTIFY_ONE_OFF_MAX_DELIVERY_ATTEMPTS) {
      await finalizeRun(serviceClient, row.id, now, { status: "cancelled", nextRunAt: now.toISOString(), lastOutcome: "error", lastError: errorText, attemptCount });
    } else {
      const nextRunAt = new Date(now.getTime() + ONE_OFF_RETRY_DELAY_MS);
      await finalizeRun(serviceClient, row.id, now, { status: "active", nextRunAt: nextRunAt.toISOString(), lastOutcome: "error", lastError: errorText, attemptCount });
    }
    return;
  }
  // Recurring: NEVER pauses on a delivery failure -- proceeds straight to
  // the next natural occurrence. attempt_count still increments, for
  // visibility via list() ("this has failed N times"), but nothing reads
  // it as a pause trigger for notify.
  const timezone = await fetchTimezoneForUser(serviceClient, row.user_id);
  const nextRunAt = computeNextRunAt(row.cron_expression as string, now, timezone);
  await finalizeRun(serviceClient, row.id, now, { status: "active", nextRunAt: nextRunAt.toISOString(), lastOutcome: "error", lastError: errorText, attemptCount: row.attempt_count + 1 });
}

/** Processes exactly one claimed row: fresh token/user check, dispatch through runMcpTool if live, then finalize (advance/pause/cancel) using the policy for its `tool_name`. Exported separately from `processScheduledActions` so a test can drive one row without needing a real claim query. */
export async function processOneScheduledAction(serviceClient: SupabaseClient, claimedRow: ScheduledActionRow, now: Date): Promise<"ok" | "error" | "denied"> {
  let row = claimedRow;
  let liveToken = await getLiveTokenById(serviceClient, row.token_id);
  if (!liveToken) {
    // P4-11 race: `row` is the copy claimed at the start of this batch. An
    // OAuth refresh can re-point the stored row to its new token and revoke
    // the old one while this batch is still working through earlier rows
    // (lib/scheduling/token-handoff.ts). Before denying, re-read the row's
    // CURRENT token_id; if it moved, check THAT token instead. A plain
    // revocation (same token) or a successor that is also revoked (refresh
    // reuse detection) still denies.
    const currentTokenId = await fetchCurrentTokenId(serviceClient, row.id);
    if (currentTokenId && currentTokenId !== row.token_id) {
      row = { ...row, token_id: currentTokenId };
      liveToken = await getLiveTokenById(serviceClient, currentTokenId);
    }
  }
  if (!liveToken) {
    await denyRow(serviceClient, row, now, "The token that scheduled this action has since been revoked.");
    return "denied";
  }

  const active = await isUserActive(serviceClient, liveToken.userId); // R4a, not optional -- see route.ts's own chain
  if (!active) {
    await denyRow(serviceClient, row, now, "The account that scheduled this action is no longer active.");
    return "denied";
  }

  const authInfo: AuthInfoLike = { scopes: liveToken.scopes, extra: { userId: liveToken.userId, tokenId: row.token_id } };
  const operation = resolveOperation(row); // recomputed fresh, never trusted from the stored column

  let result: RunMcpToolOutcome | Awaited<ReturnType<typeof runMcpTool>>;
  if (row.tool_name === "notify") {
    const timezone = await fetchTimezoneForUser(serviceClient, row.user_id);
    result = await runMcpTool(serviceClient, authInfo, "notify", operation, "write", row.args, () => dispatchNotify(serviceClient, row, timezone, now));
  } else {
    result = await runMcpTool(serviceClient, authInfo, "write", operation, "write", row.args, (userClient, userId) => writeTool(userClient, userId, row.args as WriteArgs));
  }

  // `runMcpTool`'s own return type carries only `isError` -- it does not
  // distinguish its internal "denied" (scope check failed) from a genuine
  // execution error, and widening its return shape for this one caller
  // felt like the wrong lever (see this file's header). Both fold into
  // "error" for THIS row's bounded-retry bookkeeping; the real, precise
  // distinction is already correctly recorded in mcp_audit_log by
  // runMcpTool itself, which is the source of truth requirement #1 cares
  // about -- this column is a coarser convenience, not a second ledger.
  const outcome: "ok" | "error" = result.isError ? "error" : "ok";
  const errorText = result.isError ? (result.content[0]?.type === "text" ? result.content[0].text : "error") : null;

  if (outcome === "ok") {
    await finalizeSuccess(serviceClient, row, now);
    return "ok";
  }

  if (row.tool_name === "notify") {
    await finalizeNotifyFailure(serviceClient, row, now, errorText);
  } else {
    await finalizeWriteFailure(serviceClient, row, now, errorText);
  }
  return "error";
}

export interface ProcessScheduledActionsResult {
  processed: number;
  ok: number;
  error: number;
  denied: number;
}

/** The whole poll tick's entry point: claim, then process each row in turn. One row's failure (including a thrown exception this function doesn't itself expect) must never stop the rest of the batch from being attempted. */
export async function processScheduledActions(serviceClient: SupabaseClient, now: Date = new Date()): Promise<ProcessScheduledActionsResult> {
  const claimed = await claimDueActions(serviceClient, now);
  const result: ProcessScheduledActionsResult = { processed: 0, ok: 0, error: 0, denied: 0 };

  for (const row of claimed) {
    try {
      const outcome = await processOneScheduledAction(serviceClient, row, now);
      result[outcome]++;
    } catch {
      // A row whose processing itself threw (not a write-tool/notify error
      // -- those are already caught and reported by runMcpTool as
      // `isError`, handled above) is left claimed-until-the-buffer-expires
      // rather than crashing the whole batch; the next poll tick picks it
      // back up once the claim buffer elapses, same self-healing path a
      // process crash takes (see claimDueActions' own comment).
      result.error++;
    }
    result.processed++;
  }

  return result;
}
