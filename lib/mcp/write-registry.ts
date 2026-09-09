import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markPrayerCore, toggleSunnahCore, toggleAdhkarCore } from "@/lib/deen/actions-core";
import { PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import type { RunMcpToolOutcome } from "./tool-wrapper";

/**
 * `write(domain, entity, action, id?, patch?)` — L6's dispatch table,
 * the mirror of `read`'s (lib/mcp/registry.ts). Same posture: the SHAPE is
 * the deliverable, not the coverage — `deen` holds exactly the 3 actions
 * built this layer (team-lead: "start with toggleSunnah / toggleAdhkar /
 * markPrayer... they are the owner's 'checking off logs' in the most
 * literal form"). `unmarkPrayer`'s "unlog" is DELIBERATELY NOT HERE — see
 * the header on `deen.prayer`'s action map below for why, and
 * docs/ai-connector/WRITE-DELETE-DECISION.md for the full reasoning handed
 * back to the lead rather than silently resolved.
 *
 * Every handler here calls a `core()` from lib/deen/actions-core.ts that
 * NEVER calls `requireUser()`/`getProfile()`/`getAuthedUser()` — this file
 * is itself proof that the same core a cookie-authed Server Action calls
 * is reachable from a bearer-authed MCP tool with zero duplication of the
 * actual business logic (date guards, upsert shapes, conflict keys).
 *
 * `timezone`/`now` are resolved ONCE by `lib/mcp/tools/write.ts` (the one
 * caller) and threaded through as part of `WriteContext` — never re-fetched
 * per handler, and never computed with a raw `new Date()` inside a handler
 * (AGENTS.md's timezone rule).
 */

export interface WriteContext {
  userClient: SupabaseClient;
  userId: string;
  timezone: string;
  now: Date;
}

export type WritePatch = Record<string, unknown>;

export type WriteHandler = (ctx: WriteContext, patch: WritePatch) => Promise<RunMcpToolOutcome>;

export interface WriteActionDef {
  action: string;
  description: string;
  /** Documented for list_capabilities' future use and for readers of this file — not yet enforced as a separate schema layer; each handler validates its own patch shape directly. */
  patchShape: string;
  handler: WriteHandler;
}

export interface WriteEntityDef {
  entity: string;
  actions: Record<string, WriteActionDef>;
}

export interface WriteDomainDef {
  domain: string;
  entities: Record<string, WriteEntityDef>;
}

function isPrayerName(value: unknown): value is PrayerName {
  return typeof value === "string" && (PRAYER_NAMES as readonly string[]).includes(value);
}

function requireString(patch: WritePatch, field: string): string {
  const value = patch[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`patch.${field} is required and must be a non-empty string.`);
  }
  return value;
}

function requireEnum<T extends string>(patch: WritePatch, field: string, allowed: readonly T[]): T {
  const value = patch[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`patch.${field} must be one of: ${allowed.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value as T;
}

function requirePrayerName(patch: WritePatch): PrayerName {
  const value = patch.prayer_name;
  if (!isPrayerName(value)) {
    throw new Error(`patch.prayer_name must be one of: ${PRAYER_NAMES.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

export const WRITE_REGISTRY: Record<string, WriteDomainDef> = {
  deen: {
    domain: "deen",
    entities: {
      prayer: {
        entity: "prayer",
        actions: {
          log: {
            action: "log",
            description: "Set a prayer's status for a date (on_time/qada/missed). Strictly not-after-today, server-side.",
            patchShape: "{ date: string, prayer_name: PrayerName, status: 'on_time'|'qada'|'missed' }",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const prayerName = requirePrayerName(patch);
              const status = requireEnum(patch, "status", ["on_time", "qada", "missed"] as const);
              const result = await markPrayerCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, prayerName, status);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `logged ${prayerName} on ${date} as ${status}`,
              };
            },
          },
          // "unlog" deliberately absent -- see this file's header comment
          // and docs/ai-connector/WRITE-DELETE-DECISION.md. The existing
          // cookie-authed unmarkPrayer DELETEs the row, which the MCP path
          // may never do (team-lead's guardrail); expressing "go back to
          // never-logged" without a DELETE needs either a schema change
          // (a real NULL/"cleared" state the status column doesn't have
          // today) or accepting a materially different behavior (freezing
          // at a literal "pending" status rather than the dynamic
          // upcoming/pending/missed re-derivation effectivePrayerStatus
          // gives an absent row). Neither is a call to make silently.
        },
      },
      sunnah_log: {
        entity: "sunnah_log",
        actions: {
          toggle: {
            action: "toggle",
            description: "Flip a rawatib slot's completion for a date. Strictly not-after-today, server-side.",
            patchShape: "{ date: string, prayer_name: PrayerName, slot: 'before'|'after'|'witr' }",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const prayerName = requirePrayerName(patch);
              const slot = requireEnum(patch, "slot", ["before", "after", "witr"] as const);
              const result = await toggleSunnahCore(ctx.userClient, ctx.userId, ctx.timezone, ctx.now, date, prayerName, slot);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `toggled ${prayerName}/${slot} on ${date} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      adhkar: {
        entity: "adhkar",
        actions: {
          toggle: {
            action: "toggle",
            description: "Flip morning/evening dhikr completion for a date. No future-date guard, matching the app's own behavior.",
            patchShape: "{ date: string, period: 'morning'|'evening' }",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const period = requireEnum(patch, "period", ["morning", "evening"] as const);
              const result = await toggleAdhkarCore(ctx.userClient, ctx.userId, date, period);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                  structuredContent: { updated_at: ctx.now.toISOString(), ...result },
                },
                summary: `toggled ${period} adhkar on ${date} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
    },
  },
};

export function getWriteAction(domain: string, entity: string, action: string): WriteActionDef | null {
  return WRITE_REGISTRY[domain]?.entities[entity]?.actions[action] ?? null;
}

export function listWriteActions(domain: string, entity: string): string[] {
  const entityDef = WRITE_REGISTRY[domain]?.entities[entity];
  return entityDef ? Object.keys(entityDef.actions) : [];
}

export function listWriteEntities(domain: string): string[] {
  return Object.keys(WRITE_REGISTRY[domain]?.entities ?? {});
}
