import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction } from "@/lib/mcp/write-registry";
import { resolveWriteOperation, type WriteArgs } from "@/lib/mcp/tools/write";
import { hasAnyPushSubscription } from "@/lib/notifications/send-push";
import { isValidCronExpression, computeNextRunAt } from "./cron";
import { ToolInputError, ToolNotFoundError } from "@/lib/mcp/tool-input-error";

/**
 * `core(supabase, userId, ...)` extraction for `scheduler_manage`'s four
 * actions — list/create/cancel/pause against `mcp_scheduled_actions` (L7).
 * `supabase` here is the RLS-scoped client `runMcpTool` already builds for
 * this call (same as every other tool's own core layer) — this file is NOT
 * the background runner (lib/mcp/scheduler-runner.ts), which needs
 * cross-user visibility a service-role client for a different reason.
 *
 * SCHEDULABLE TOOL SCOPE: `tool_name` is `"write"` or `"notify"` (CHECK-
 * constrained at the DB level to exactly those two) — a scheduled
 * `read`/`list_capabilities` still has no delivery channel for its
 * RESULT, and `widget_manage` wasn't asked for. `notify` was added
 * specifically because a scheduled action that runs correctly but never
 * reaches the owner satisfies "schedule a reminder" on a technicality and
 * fails the actual requirement (team-lead's ruling) — see
 * lib/notifications/notify-core.ts for the delivery mechanism.
 */

export interface ScheduledActionItem {
  id: string;
  tool_name: "write" | "notify";
  domain: string;
  entity: string;
  action: string;
  /** The underlying write's own target row id, if it targets an existing row (edit-shaped actions) — null for a create-shaped one, and always null for a notify action. */
  write_id: string | null;
  /** The underlying write's own patch — surfaced in full, not summarized, so a caller reviewing "what's pending" (team-lead's own framing: seeing this without opening a database client) can see exactly what will run, not just its name. Null for a notify action -- see title/body instead. */
  write_patch: Record<string, unknown> | null;
  /** Only set for a notify action. */
  title: string | null;
  body: string | null;
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
  tool_name: "write" | "notify";
  args: { domain?: string; entity?: string; action?: string; id?: string; patch?: Record<string, unknown>; title?: string; body?: string };
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
  const isNotify = row.tool_name === "notify";
  return {
    id: row.id,
    tool_name: row.tool_name,
    domain: isNotify ? "" : (row.args.domain ?? ""),
    entity: isNotify ? "" : (row.args.entity ?? ""),
    action: isNotify ? "" : (row.args.action ?? ""),
    write_id: isNotify ? null : (row.args.id ?? null),
    write_patch: isNotify ? null : (row.args.patch ?? null),
    title: isNotify ? (row.args.title ?? null) : null,
    body: isNotify ? (row.args.body ?? null) : null,
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
    .select("id, tool_name, args, cron_expression, run_at, next_run_at, last_run_at, last_outcome, last_error, attempt_count, status, updated_at")
    .eq("user_id", userId)
    .order("next_run_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ScheduledActionRow[]).map(toItem);
}

function requireStringField(patch: Record<string, unknown>, field: string): string {
  const value = patch[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`patch.${field} is required and must be a non-empty string.`);
  }
  return value;
}

export interface CreateScheduledActionResult {
  id: string;
  next_run_at: string;
}

/** Parses/validates the run_at-XOR-cron_expression half, shared by both the write and notify branches below — the ONE-OFF vs RECURRING decision is identical regardless of what's being scheduled. */
function resolveSchedule(patch: Record<string, unknown>, timezone: string, now: Date): { nextRunAt: Date; runAt: string | null; cronExpression: string | null } {
  const hasRunAt = patch.run_at !== undefined;
  const hasCron = patch.cron_expression !== undefined;
  if (hasRunAt === hasCron) {
    throw new ToolInputError("Provide exactly one of patch.run_at (a one-off ISO instant) or patch.cron_expression (a recurring schedule) -- never both, never neither.");
  }

  if (hasRunAt) {
    if (typeof patch.run_at !== "string") throw new ToolInputError("patch.run_at must be a string (ISO 8601 instant).");
    const parsed = new Date(patch.run_at);
    if (Number.isNaN(parsed.getTime())) throw new ToolInputError(`patch.run_at must be a valid ISO 8601 instant. Got: ${JSON.stringify(patch.run_at)}.`);
    if (parsed.getTime() <= now.getTime()) throw new ToolInputError("patch.run_at must be in the future.");
    return { nextRunAt: parsed, runAt: parsed.toISOString(), cronExpression: null };
  }

  if (typeof patch.cron_expression !== "string" || !isValidCronExpression(patch.cron_expression)) {
    throw new ToolInputError(`patch.cron_expression must be "MM HH * * *" (daily, local time) or "MM HH * * D" (weekly, D=0-6, 0=Sunday). Got: ${JSON.stringify(patch.cron_expression)}.`);
  }
  return { nextRunAt: computeNextRunAt(patch.cron_expression, now, timezone), runAt: null, cronExpression: patch.cron_expression };
}

/**
 * Validates and stores a NEW scheduled WRITE — does NOT run it. The
 * underlying write's own patch shape is NOT pre-validated here beyond
 * basic JSON-object shape (that would mean either duplicating every write
 * handler's own validation a second time, drift-prone by construction, or
 * actually invoking the write as a side effect just to check it, which is
 * not a dry run at all). A malformed write_patch is instead discovered at
 * FIRST FIRE, same as the token-scope check — audited as a real "error"
 * outcome, subject to the runner's own bounded-retry-then-pause policy.
 */
async function createWriteScheduledAction(
  supabase: SupabaseClient,
  userId: string,
  tokenId: string,
  timezone: string,
  now: Date,
  patch: Record<string, unknown>,
): Promise<CreateScheduledActionResult> {
  const domain = requireStringField(patch, "domain");
  const entity = requireStringField(patch, "entity");
  const action = requireStringField(patch, "action");

  const actionDef = getWriteAction(domain, entity, action);
  if (!actionDef) {
    throw new ToolInputError(`Unknown write action "${domain}.${entity}.${action}". Call list_capabilities("${domain}") to see what's available.`);
  }
  // Absence of `idempotent: true` means NOT VERIFIED, not "assumed safe" —
  // see WriteActionDef's own comment (write-registry.ts). Refused here,
  // loudly, rather than scheduling something at-least-once delivery could
  // silently duplicate.
  if (actionDef.idempotent !== true) {
    throw new ToolInputError(
      `"${domain}.${entity}.${action}" isn't verified safe to schedule yet -- an unattended scheduled action can run twice for the same firing (at-least-once delivery), and this one hasn't been confirmed to tolerate that without duplicating data. It can still be called directly through write(), just not scheduled.`,
    );
  }

  const writeId = patch.write_id;
  if (writeId !== undefined && typeof writeId !== "string") {
    throw new ToolInputError(`patch.write_id must be a string if given. Got: ${JSON.stringify(writeId)}.`);
  }
  const writePatch = patch.write_patch;
  if (writePatch !== undefined && (typeof writePatch !== "object" || writePatch === null || Array.isArray(writePatch))) {
    throw new ToolInputError("patch.write_patch must be an object if given.");
  }

  const { nextRunAt, runAt, cronExpression } = resolveSchedule(patch, timezone, now);

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
 * Validates and stores a NEW scheduled NOTIFY (a reminder) — does NOT send
 * it. Refuses at SCHEDULE time, not fire time, when this user has no
 * registered device at all (team-lead's requirement #4: creating a
 * reminder that cannot possibly be delivered, discovered hours later in
 * an audit log, is the same silent-failure trap this whole layer exists
 * to close). This is a best-effort guard, not a guarantee — a device
 * registered now can still unsubscribe before the reminder fires; that
 * later case is a genuine delivery failure, handled at fire time by
 * lib/notifications/notify-core.ts, not by this check.
 */
async function createNotifyScheduledAction(
  supabase: SupabaseClient,
  userId: string,
  tokenId: string,
  timezone: string,
  now: Date,
  patch: Record<string, unknown>,
): Promise<CreateScheduledActionResult> {
  const title = requireStringField(patch, "title");
  const body = requireStringField(patch, "body");

  if (!(await hasAnyPushSubscription(supabase, userId))) {
    throw new ToolInputError("No push notifications are enabled on any device yet -- enable them in Settings before scheduling a reminder, or this could never actually reach you.");
  }

  const { nextRunAt, runAt, cronExpression } = resolveSchedule(patch, timezone, now);

  const { data, error } = await supabase
    .from("mcp_scheduled_actions")
    .insert({
      user_id: userId,
      token_id: tokenId,
      tool_name: "notify",
      operation: "notify.send",
      args: { title, body },
      cron_expression: cronExpression,
      run_at: runAt,
      next_run_at: nextRunAt.toISOString(),
    })
    .select("id, next_run_at")
    .single();
  if (error) throw error;
  return { id: data.id as string, next_run_at: data.next_run_at as string };
}

/** Dispatches on `patch.tool_name` ('write' | 'notify', required) — the top-level branch scheduler_manage's create action needs before anything else is even parseable, since the two shapes share almost no fields. */
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

  const toolName = patch.tool_name;
  if (toolName === "write") return createWriteScheduledAction(supabase, userId, tokenId, timezone, now, patch);
  if (toolName === "notify") return createNotifyScheduledAction(supabase, userId, tokenId, timezone, now, patch);
  throw new ToolInputError(`patch.tool_name must be "write" or "notify". Got: ${JSON.stringify(toolName)}.`);
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
  if (!data) throw new ToolNotFoundError(`No scheduled action found with id "${id}".`);
}

/** Sets `status: 'paused'` — the poll skips it (only `status='active'` rows are ever due), but it stays listed and can be re-created if the caller wants it running again. There is no separate "resume" action in this pass -- cancel and re-create with `scheduler_manage("create")` is the only path back to active, matching exactly the four actions asked for. */
export async function pauseScheduledActionCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from("mcp_scheduled_actions").update({ status: "paused" }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolNotFoundError(`No scheduled action found with id "${id}".`);
}
