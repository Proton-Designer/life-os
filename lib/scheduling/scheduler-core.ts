import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction } from "@/lib/mcp/write-registry";
import { resolveWriteOperation, type WriteArgs } from "@/lib/mcp/tools/write";
import { isValidCronExpression, computeNextRunAt } from "./cron";

/**
 * `core(supabase, userId, ...)` extraction for `scheduler_manage`'s four
 * actions — list/create/cancel/pause against `mcp_scheduled_actions` (L7).
 * `supabase` here is the RLS-scoped client `runMcpTool` already builds for
 * this call (same as every other tool's own core layer) — this file is NOT
 * the background runner (lib/mcp/scheduler-runner.ts), which needs
 * cross-user visibility a service-role client for a different reason.
 *
 * SCHEDULABLE TOOL SCOPE: `tool_name` is hardcoded to `"write"` here (and
 * CHECK-constrained to it at the DB level, migration draft) — a scheduled
 * `read`/`list_capabilities` has no delivery channel for its result (no
 * push/notification wiring exists for MCP output today), and
 * `widget_manage` wasn't asked for. Widening this is a plain, additive
 * change whenever a real use case exists; not guessed at here.
 */

export interface ScheduledActionItem {
  id: string;
  domain: string;
  entity: string;
  action: string;
  /** The underlying write's own target row id, if it targets an existing row (edit-shaped actions) — null for a create-shaped one. */
  write_id: string | null;
  /** The underlying write's own patch — surfaced in full, not summarized, so a caller reviewing "what's pending" (team-lead's own framing: seeing this without opening a database client) can see exactly what will run, not just its name. */
  write_patch: Record<string, unknown> | null;
  cron_expression: string | null;
  run_at: string | null;
  next_run_at: string;
  last_run_at: string | null;
  last_outcome: string | null;
  last_error: string | null;
  attempt_count: number;
  status: string;
  updated_at: string;
}

interface ScheduledActionRow {
  id: string;
  args: { domain?: string; entity?: string; action?: string; id?: string; patch?: Record<string, unknown> };
  cron_expression: string | null;
  run_at: string | null;
  next_run_at: string;
  last_run_at: string | null;
  last_outcome: string | null;
  last_error: string | null;
  attempt_count: number;
  status: string;
  updated_at: string;
}

function toItem(row: ScheduledActionRow): ScheduledActionItem {
  return {
    id: row.id,
    domain: row.args.domain ?? "",
    entity: row.args.entity ?? "",
    action: row.args.action ?? "",
    write_id: row.args.id ?? null,
    write_patch: row.args.patch ?? null,
    cron_expression: row.cron_expression,
    run_at: row.run_at,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_outcome: row.last_outcome,
    last_error: row.last_error,
    attempt_count: row.attempt_count,
    status: row.status,
    updated_at: row.updated_at,
  };
}

/** Every scheduled action this user has, cancelled/paused ones included — same "history stays visible" precedent as listAccessTokens (lib/mcp/tokens.ts) and widget_manage's own list. */
export async function listScheduledActionsCore(supabase: SupabaseClient, userId: string): Promise<ScheduledActionItem[]> {
  const { data, error } = await supabase
    .from("mcp_scheduled_actions")
    .select("id, args, cron_expression, run_at, next_run_at, last_run_at, last_outcome, last_error, attempt_count, status, updated_at")
    .eq("user_id", userId)
    .order("next_run_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ScheduledActionRow[]).map(toItem);
}

function requireStringField(patch: Record<string, unknown>, field: string): string {
  const value = patch[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`patch.${field} is required and must be a non-empty string.`);
  }
  return value;
}

export interface CreateScheduledActionResult {
  id: string;
  next_run_at: string;
}

/**
 * Validates and stores a NEW scheduled write — does NOT run it. The
 * underlying write's own patch shape is NOT pre-validated here beyond
 * basic JSON-object shape (that would mean either duplicating every write
 * handler's own validation a second time, drift-prone by construction, or
 * actually invoking the write as a side effect just to check it, which is
 * not a dry run at all). A malformed write_patch is instead discovered at
 * FIRST FIRE, same as the token-scope check — audited as a real "error"
 * outcome, subject to the runner's own bounded-retry-then-pause policy.
 */
export async function createScheduledActionCore(
  supabase: SupabaseClient,
  userId: string,
  tokenId: string | null,
  timezone: string,
  now: Date,
  patch: Record<string, unknown>,
): Promise<CreateScheduledActionResult> {
  if (!tokenId) {
    throw new Error("No token id available for this call -- cannot schedule an action without knowing which token authorizes it.");
  }

  const domain = requireStringField(patch, "domain");
  const entity = requireStringField(patch, "entity");
  const action = requireStringField(patch, "action");

  const actionDef = getWriteAction(domain, entity, action);
  if (!actionDef) {
    throw new Error(`Unknown write action "${domain}.${entity}.${action}". Call list_capabilities("${domain}") to see what's available.`);
  }
  // Absence of `idempotent: true` means NOT VERIFIED, not "assumed safe" —
  // see WriteActionDef's own comment (write-registry.ts). Refused here,
  // loudly, rather than scheduling something at-least-once delivery could
  // silently duplicate.
  if (actionDef.idempotent !== true) {
    throw new Error(
      `"${domain}.${entity}.${action}" isn't verified safe to schedule yet -- an unattended scheduled action can run twice for the same firing (at-least-once delivery), and this one hasn't been confirmed to tolerate that without duplicating data. It can still be called directly through write(), just not scheduled.`,
    );
  }

  const writeId = patch.write_id;
  if (writeId !== undefined && typeof writeId !== "string") {
    throw new Error(`patch.write_id must be a string if given. Got: ${JSON.stringify(writeId)}.`);
  }
  const writePatch = patch.write_patch;
  if (writePatch !== undefined && (typeof writePatch !== "object" || writePatch === null || Array.isArray(writePatch))) {
    throw new Error("patch.write_patch must be an object if given.");
  }

  const hasRunAt = patch.run_at !== undefined;
  const hasCron = patch.cron_expression !== undefined;
  if (hasRunAt === hasCron) {
    throw new Error("Provide exactly one of patch.run_at (a one-off ISO instant) or patch.cron_expression (a recurring schedule) -- never both, never neither.");
  }

  let nextRunAt: Date;
  let runAt: string | null = null;
  let cronExpression: string | null = null;

  if (hasRunAt) {
    if (typeof patch.run_at !== "string") throw new Error("patch.run_at must be a string (ISO 8601 instant).");
    const parsed = new Date(patch.run_at);
    if (Number.isNaN(parsed.getTime())) throw new Error(`patch.run_at must be a valid ISO 8601 instant. Got: ${JSON.stringify(patch.run_at)}.`);
    if (parsed.getTime() <= now.getTime()) throw new Error("patch.run_at must be in the future.");
    nextRunAt = parsed;
    runAt = parsed.toISOString();
  } else {
    if (typeof patch.cron_expression !== "string" || !isValidCronExpression(patch.cron_expression)) {
      throw new Error(`patch.cron_expression must be "MM HH * * *" (daily, local time) or "MM HH * * D" (weekly, D=0-6, 0=Sunday). Got: ${JSON.stringify(patch.cron_expression)}.`);
    }
    cronExpression = patch.cron_expression;
    nextRunAt = computeNextRunAt(cronExpression, now, timezone);
  }

  const writeArgs: WriteArgs = { domain, entity, action, ...(typeof writeId === "string" ? { id: writeId } : {}), ...(writePatch ? { patch: writePatch as Record<string, unknown> } : {}) };
  const operation = resolveWriteOperation(writeArgs);

  const { data, error } = await supabase
    .from("mcp_scheduled_actions")
    .insert({
      user_id: userId,
      token_id: tokenId,
      tool_name: "write",
      operation,
      args: writeArgs,
      cron_expression: cronExpression,
      run_at: runAt,
      next_run_at: nextRunAt.toISOString(),
    })
    .select("id, next_run_at")
    .single();
  if (error) throw error;
  return { id: data.id as string, next_run_at: data.next_run_at as string };
}

/**
 * Soft-cancel — sets `status: 'cancelled'`, never a hard DELETE (this
 * program's own standing no-hard-delete rule for every MCP write path).
 * Only affects an `active`/`paused` row belonging to this user; a
 * not-found/not-yours/already-cancelled id is reported the same clear way
 * as everywhere else in this registry.
 */
export async function cancelScheduledActionCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from("mcp_scheduled_actions").update({ status: "cancelled" }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No scheduled action found with id "${id}".`);
}

/** Sets `status: 'paused'` — the poll skips it (only `status='active'` rows are ever due), but it stays listed and can be re-created if the caller wants it running again. There is no separate "resume" action in this pass -- cancel and re-create with `scheduler_manage("create")` is the only path back to active, matching exactly the four actions asked for. */
export async function pauseScheduledActionCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from("mcp_scheduled_actions").update({ status: "paused" }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No scheduled action found with id "${id}".`);
}
