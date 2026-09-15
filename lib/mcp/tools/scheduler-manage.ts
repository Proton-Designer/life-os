import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTimezone } from "@/lib/deen/actions-core";
import { listScheduledActionsCore, createScheduledActionCore, cancelScheduledActionCore, pauseScheduledActionCore } from "@/lib/scheduling/scheduler-core";
import type { RunMcpToolOutcome } from "../tool-wrapper";
import { ToolInputError } from "../tool-input-error";

/**
 * `scheduler_manage(action: "list"|"create"|"cancel"|"pause", id?, patch?)`
 * — L7's dedicated tool (docs/ai-connector/PROGRAM-PLAN.md), NOT routed
 * through the generic `write` dispatch, same posture `widget_manage`
 * already takes on its own top-level tool status.
 *
 * `timezone`/`now` are fetched/computed ONCE here — this module's one
 * caller — mirroring `lib/mcp/tools/write.ts`'s own exact pattern (AGENTS.md's
 * rule: exactly one place in a write path touches `profiles.timezone`).
 *
 * `tokenId` is threaded in from route.ts's own `readMcpAuth(ctx.http?.authInfo)`
 * call, NOT from `runMcpTool`'s `fn(userClient, userId)` signature — that
 * signature has no slot for it (no other tool has ever needed the calling
 * token's OWN id, only its scopes, which `runMcpTool` already checks before
 * `fn` ever runs). Widening `runMcpTool` itself for one caller felt like
 * the wrong lever; re-deriving `tokenId` a second time via the same pure,
 * already-exported `readMcpAuth` is cheap and keeps every other tool's
 * signature untouched.
 */

export interface SchedulerManageArgs {
  action: "list" | "create" | "cancel" | "pause";
  id?: string;
  patch?: Record<string, unknown>;
}

/** `list` only ever reads; `create`/`cancel`/`pause` mutate — same per-call resolution `widget_manage` already uses, so a read-only token can still see its own schedule. */
export function resolveSchedulerManageScope(action: SchedulerManageArgs["action"]): "read" | "write" {
  return action === "list" ? "read" : "write";
}

export function resolveSchedulerManageOperation(args: SchedulerManageArgs): string {
  return `scheduler_manage.${args.action}`;
}

function requireId(args: SchedulerManageArgs): string {
  if (!args.id) throw new ToolInputError("This action requires the top-level `id` of the scheduled action.");
  return args.id;
}

export async function schedulerManageTool(supabase: SupabaseClient, userId: string, tokenId: string | null, args: SchedulerManageArgs): Promise<RunMcpToolOutcome> {
  switch (args.action) {
    case "list": {
      const items = await listScheduledActionsCore(supabase, userId);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ items }) }], structuredContent: { items } },
        summary: `listed ${items.length} scheduled action(s)`,
      };
    }

    case "create": {
      const timezone = await fetchTimezone(supabase, userId);
      const now = new Date();
      const result = await createScheduledActionCore(supabase, userId, tokenId, timezone, now, args.patch ?? {});
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: { id: result.id, updated_at: now.toISOString(), next_run_at: result.next_run_at },
        },
        summary: `scheduled action ${result.id}, next run ${result.next_run_at}`,
      };
    }

    case "cancel": {
      const id = requireId(args);
      await cancelScheduledActionCore(supabase, userId, id);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: new Date().toISOString() } },
        summary: `cancelled scheduled action ${id}`,
      };
    }

    case "pause": {
      const id = requireId(args);
      await pauseScheduledActionCore(supabase, userId, id);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: new Date().toISOString() } },
        summary: `paused scheduled action ${id}`,
      };
    }
  }
}
