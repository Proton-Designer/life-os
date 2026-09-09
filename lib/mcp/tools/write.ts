import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTimezone } from "@/lib/deen/actions-core";
import { getWriteAction, listWriteEntities, listWriteActions, type WritePatch } from "../write-registry";
import type { RunMcpToolOutcome } from "../tool-wrapper";

export interface WriteArgs {
  domain: string;
  entity: string;
  action: string;
  id?: string;
  patch?: WritePatch;
}

/** migration 131's resolved-operation column — "deen.prayer.log", "deen.sunnah_log.toggle". */
export function resolveWriteOperation(args: WriteArgs): string {
  return `${args.domain}.${args.entity}.${args.action}`;
}

/**
 * `write(domain, entity, action, id?, patch?)` — dispatches through
 * lib/mcp/write-registry.ts. Untyped `SupabaseClient`, same reason as
 * `read.ts`: a registry-driven dynamic table dispatcher can't be typed
 * against the generated `Database` union.
 *
 * `timezone` is fetched ONCE here (the one caller of the registry's
 * handlers), never inside a handler or a core function — AGENTS.md's rule,
 * enforced structurally rather than by convention: there is exactly one
 * place in the whole write path that touches `profiles.timezone`.
 */
export async function writeTool(supabase: SupabaseClient, userId: string, args: WriteArgs): Promise<RunMcpToolOutcome> {
  const actionDef = getWriteAction(args.domain, args.entity, args.action);
  if (!actionDef) {
    const entities = listWriteEntities(args.domain);
    if (entities.length === 0) {
      throw new Error(`No writable entities for domain "${args.domain}". Call list_capabilities("${args.domain}") to see what's readable.`);
    }
    if (!entities.includes(args.entity)) {
      throw new Error(`Unknown writable entity "${args.entity}" for domain "${args.domain}". Writable entities: ${entities.join(", ")}.`);
    }
    const actions = listWriteActions(args.domain, args.entity);
    throw new Error(`Unknown action "${args.action}" for ${args.domain}.${args.entity}. Available actions: ${actions.join(", ") || "(none)"}.`);
  }

  const timezone = await fetchTimezone(supabase, userId);
  const now = new Date();
  return actionDef.handler({ userClient: supabase, userId, timezone, now, id: args.id }, args.patch ?? {});
}
