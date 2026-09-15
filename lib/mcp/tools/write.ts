import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTimezone } from "@/lib/deen/actions-core";
import { getWriteAction, listWriteEntities, listWriteActions, type WritePatch } from "../write-registry";
import type { RunMcpToolOutcome } from "../tool-wrapper";
import { ToolInputError } from "../tool-input-error";
import { localDateString } from "@/lib/date-utils";
import { DATE_DEFAULTS_TO_TODAY, writeActionKey } from "@/lib/agent-api/write-action-meta";

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
      throw new ToolInputError(`No writable entities for domain "${args.domain}". Call list_capabilities("${args.domain}") to see what's readable.`);
    }
    if (!entities.includes(args.entity)) {
      throw new ToolInputError(`Unknown writable entity "${args.entity}" for domain "${args.domain}". Writable entities: ${entities.join(", ")}.`);
    }
    const actions = listWriteActions(args.domain, args.entity);
    throw new ToolInputError(`Unknown action "${args.action}" for ${args.domain}.${args.entity}. Available actions: ${actions.join(", ") || "(none)"}.`);
  }

  const timezone = await fetchTimezone(supabase, userId);
  const now = new Date();
  return actionDef.handler({ userClient: supabase, userId, timezone, now, id: args.id }, withDateDefault(args, timezone, now));
}

/**
 * P4-03: a log-shaped action whose `patch.date` is omitted gets the ACCOUNT'S
 * local today — never the raw Date's UTC day, which is tomorrow for a user in
 * the Americas every evening. Only for actions listed in DATE_DEFAULTS_TO_TODAY
 * (lib/agent-api/write-action-meta.ts, drift-guarded against write-registry.ts);
 * actions where a guessed date could change the wrong row still require it.
 * An explicitly sent date, even an invalid one, is passed through untouched
 * for the handler's own validation.
 */
function withDateDefault(args: WriteArgs, timezone: string, now: Date): WritePatch {
  const patch = args.patch ?? {};
  if (patch.date !== undefined) return patch;
  if (!DATE_DEFAULTS_TO_TODAY.has(writeActionKey(args.domain, args.entity, args.action))) return patch;
  return { ...patch, date: localDateString(now, timezone) };
}
