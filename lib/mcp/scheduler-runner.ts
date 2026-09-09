import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveTokenById } from "./tokens";
import { isUserActive } from "./active-user";
import { writeAuditRow } from "./audit";
import { runMcpTool } from "./tool-wrapper";
import { writeTool, resolveWriteOperation, type WriteArgs } from "./tools/write";
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
 * THE ONE NECESSARY EXCEPTION: when a token turns out to be revoked, or
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
 * REQUIREMENT #3 (bounded retry): a consecutive-failure streak past
 * `MAX_CONSECUTIVE_FAILURES` PAUSES the row rather than retrying forever —
 * a runaway loop against a write surface is this program's worst failure
 * mode. A DENIAL (revoked token, inactive user) pauses IMMEDIATELY,
 * without burning through the failure budget first — a denial is not a
 * transient condition; it will not resolve itself by trying again in 5
 * minutes the way a real transient error (a dropped connection, a brief
 * DB hiccup) might. `MAX_CONSECUTIVE_FAILURES` and `ONE_OFF_RETRY_DELAY_MS`
 * below are MINE, not specified — same posture rate-limit.ts's own
 * defaults take: placeholders the owner/lead should revisit once real
 * scheduled-action traffic exists, not researched constants.
 *
 * REQUIREMENT #4 (at-least-once, so writes must tolerate running twice):
 * `claimDueActions`'s own comment explains the concrete mechanism (an
 * atomic claim-via-bump UPDATE) and the honest gap it leaves (a crash
 * between claim and finalize). This runner does NOT filter which actions
 * it will fire by idempotency — that gate is entirely at SCHEDULE time
 * (`createScheduledActionCore` refuses anything not marked
 * `idempotent: true` in write-registry.ts). By the time a row reaches
 * this runner, it was already only ever allowed to be created if it's
 * safe to run more than once.
 */

export const MAX_CONSECUTIVE_FAILURES = 5;
const ONE_OFF_RETRY_DELAY_MS = 5 * 60 * 1000;
/** How long a claim's temporary bump holds before a crashed run's row becomes due again on its own — the self-healing half of "at-least-once," not a tunable retry interval. */
const CLAIM_BUFFER_MS = 10 * 60 * 1000;

interface ScheduledActionRow {
  id: string;
  user_id: string;
  token_id: string;
  args: WriteArgs;
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
    .select("id, user_id, token_id, args, cron_expression, run_at, attempt_count");
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

/** Fetches just the timezone this one row's owner needs to advance a recurring schedule — a per-row lookup, not threaded from anywhere, since a poll batch can span many different users. */
async function fetchTimezoneForUser(serviceClient: SupabaseClient, userId: string): Promise<string> {
  const { data } = await serviceClient.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return (data?.timezone as string | undefined) ?? "UTC";
}

async function denyRow(
  serviceClient: SupabaseClient,
  row: ScheduledActionRow,
  now: Date,
  reason: string,
): Promise<void> {
  // Same audit primitive runMcpTool itself calls internally -- see this
  // file's own header for why this is the one necessary exception to
  // "always dispatch through runMcpTool."
  await writeAuditRow(serviceClient, {
    userId: row.user_id,
    tokenId: row.token_id,
    toolName: "write",
    operation: resolveWriteOperation(row.args),
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

/** Processes exactly one claimed row: fresh token/user check, dispatch through runMcpTool if live, then finalize (advance/pause/cancel). Exported separately from `processScheduledActions` so a test can drive one row without needing a real claim query. */
export async function processOneScheduledAction(serviceClient: SupabaseClient, row: ScheduledActionRow, now: Date): Promise<"ok" | "error" | "denied"> {
  const liveToken = await getLiveTokenById(serviceClient, row.token_id);
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
  const operation = resolveWriteOperation(row.args); // recomputed fresh, never trusted from the stored column
  const result = await runMcpTool(serviceClient, authInfo, "write", operation, "write", row.args, (userClient, userId) => writeTool(userClient, userId, row.args));

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
    if (row.run_at) {
      // One-off: done. "cancelled" and "will never fire again because it
      // succeeded" are the same fact `status` needs to carry -- see the
      // migration draft's own header on why there's no separate "completed".
      await finalizeRun(serviceClient, row.id, now, { status: "cancelled", nextRunAt: now.toISOString(), lastOutcome: "ok", lastError: null, attemptCount: 0 });
    } else {
      const timezone = await fetchTimezoneForUser(serviceClient, row.user_id);
      const nextRunAt = computeNextRunAt(row.cron_expression as string, now, timezone);
      // A SUCCESS resets the failure streak to 0 -- only CONSECUTIVE
      // failures should ever pause a row, never a cumulative-ever count.
      await finalizeRun(serviceClient, row.id, now, { status: "active", nextRunAt: nextRunAt.toISOString(), lastOutcome: "ok", lastError: null, attemptCount: 0 });
    }
    return "ok";
  }

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
      // A row whose processing itself threw (not a write-tool error --
      // those are already caught and reported by runMcpTool as `isError`,
      // handled above) is left claimed-until-the-buffer-expires rather
      // than crashing the whole batch; the next poll tick picks it back
      // up once the claim buffer elapses, same self-healing path a
      // process crash takes (see claimDueActions' own comment).
      result.error++;
    }
    result.processed++;
  }

  return result;
}
