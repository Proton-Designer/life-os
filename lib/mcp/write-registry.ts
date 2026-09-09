import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markPrayerCore, toggleSunnahCore, toggleAdhkarCore } from "@/lib/deen/actions-core";
import { addTargetCore, addStretchGoalCore, editTargetCore, completeTargetCore, moveTargetCore } from "@/lib/coop/targets-core";
import { addAgendaTaskCore, editTaskCore, advanceTaskCore, retreatTaskCore, blockTaskCore, unblockTaskCore } from "@/lib/coop/tasks-core";
import { setKillListItemCore, toggleKillListItemCore, saveBusinessWeeklyGoalCore, startWorkSessionCore, endWorkSessionCore } from "@/lib/business/actions-core";
import type { CoopTaskStatus } from "@/lib/coop/tasks";
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
  /** `write(..., id?, ...)`'s top-level id — for actions that target an EXISTING row by id (edit/advance/reorder/...), as opposed to deen's date-keyed actions, which never use it. */
  id?: string;
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

function requireNumberEnum<T extends number>(patch: WritePatch, field: string, allowed: readonly T[]): T {
  const value = patch[field];
  if (typeof value !== "number" || !(allowed as readonly number[]).includes(value)) {
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

/** The top-level `write(..., id, ...)` — required by every action here that targets an existing row (edit/advance/reorder/toggle/...), as opposed to deen's date-keyed actions. */
function requireId(ctx: WriteContext): string {
  if (!ctx.id) throw new Error("This action requires the top-level `id` of the row to act on.");
  return ctx.id;
}

function optionalNumber(patch: WritePatch, field: string): number | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error(`patch.${field} must be a number. Got: ${JSON.stringify(value)}.`);
  return value;
}

function optionalString(patch: WritePatch, field: string): string | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`patch.${field} must be a string. Got: ${JSON.stringify(value)}.`);
  return value;
}

function optionalNullableString(patch: WritePatch, field: string): string | null | undefined {
  const value = patch[field];
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") throw new Error(`patch.${field} must be a string or null. Got: ${JSON.stringify(value)}.`);
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
  work: {
    domain: "work",
    entities: {
      target: {
        entity: "target",
        actions: {
          create: {
            action: "create",
            description: "Create a target (requires patch.deadline) or a stretch goal (never requires one), per patch.kind.",
            patchShape: "{ kind: 'target'|'stretch', title: string, deadline?: string }",
            handler: async (ctx, patch) => {
              const kind = requireEnum(patch, "kind", ["target", "stretch"] as const);
              const title = requireString(patch, "title");
              const id =
                kind === "target"
                  ? await addTargetCore(ctx.userClient, ctx.userId, title, optionalString(patch, "deadline") ?? "")
                  : await addStretchGoalCore(ctx.userClient, ctx.userId, title);
              if (!id) throw new Error("Title was blank after trimming — nothing was created.");
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `created ${kind} "${title}"`,
              };
            },
          },
          edit: {
            action: "edit",
            description: "Edit an existing target/stretch goal's title and/or deadline. Requires the top-level id.",
            patchShape: "{ title?: string, deadline?: string|null }",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await editTargetCore(ctx.userClient, ctx.userId, id, { title: optionalString(patch, "title"), deadline: optionalNullableString(patch, "deadline") });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited target ${id}`,
              };
            },
          },
          complete: {
            action: "complete",
            description: "Mark a target/stretch goal done. Requires the top-level id. Never a delete — the row's history is kept (ruling 5).",
            patchShape: "{}",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const promotion = await completeTargetCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...promotion }) }], structuredContent: { id, updated_at: null, ...promotion } },
                summary: `completed target ${id}${promotion.promotedTargetId ? `, promoted ${promotion.promotedTargetId}` : ""}`,
              };
            },
          },
          reorder: {
            action: "reorder",
            description: "Move a target/stretch goal to a new position — the 'in diff order optionally' mechanism. Requires the top-level id and patch.position.",
            patchShape: "{ position: number }",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              const position = optionalNumber(patch, "position");
              if (position === undefined) throw new Error("patch.position is required.");
              await moveTargetCore(ctx.userClient, ctx.userId, id, position);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, position }) }], structuredContent: { id, updated_at: null, position } },
                summary: `moved target ${id} to position ${position}`,
              };
            },
          },
          // "remove" deliberately absent -- delete_coop_target is a real
          // DELETE (guarded against a completed target, migration 032, but
          // not against an active one), and the MCP write path may never
          // hard-delete a row (L6's guardrail). Same posture as deen's
          // "unlog" -- an honest gap, not a workaround.
        },
      },
      task: {
        entity: "task",
        actions: {
          add: {
            action: "add",
            description: "Add a task to a target's backlog. Requires the top-level id (the target's id).",
            patchShape: "{ title: string, deadline?: string }",
            handler: async (ctx, patch) => {
              const targetId = requireId(ctx);
              const title = requireString(patch, "title");
              const id = await addAgendaTaskCore(ctx.userClient, targetId, title, optionalString(patch, "deadline"));
              if (!id) throw new Error("Title was blank after trimming — nothing was created.");
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `added task "${title}" to target ${targetId}`,
              };
            },
          },
          edit: {
            action: "edit",
            description: "Edit an existing task's title and/or deadline. Requires the top-level id.",
            patchShape: "{ title?: string, deadline?: string|null }",
            handler: async (ctx, patch) => {
              const id = requireId(ctx);
              await editTaskCore(ctx.userClient, ctx.userId, id, { title: optionalString(patch, "title"), deadline: optionalNullableString(patch, "deadline") });
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                summary: `edited task ${id}`,
              };
            },
          },
          ...(["advance", "retreat", "block", "unblock"] as const).reduce(
            (acc, action) => {
              acc[action] = {
                action,
                description: `${action[0].toUpperCase()}${action.slice(1)} a task one pipeline stage. Requires the top-level id and patch.current_status${action === "unblock" ? " (the status to restore)" : ""}.`,
                patchShape: "{ current_status: 'backlog'|'in_progress'|'review'|'complete'|'blocked' }",
                handler: async (ctx: WriteContext, patch: WritePatch) => {
                  const id = requireId(ctx);
                  const currentStatus = requireEnum(patch, "current_status", ["backlog", "in_progress", "review", "blocked", "complete"] as const) as Exclude<
                    CoopTaskStatus,
                    "blocked"
                  >;
                  const coreFn = { advance: advanceTaskCore, retreat: retreatTaskCore, block: blockTaskCore, unblock: unblockTaskCore }[action];
                  await coreFn(ctx.userClient, ctx.userId, id, currentStatus);
                  return {
                    result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: null } },
                    summary: `${action}d task ${id}`,
                  };
                },
              };
              return acc;
            },
            {} as Record<string, WriteActionDef>,
          ),
          // "remove"/"bulk_remove" deliberately absent -- both are real
          // DELETEs with no completion-history guard at all (ruling 5 is
          // about targets, not tasks). Same posture as everywhere else in
          // this registry: the MCP write path never hard-deletes.
        },
      },
      work_session: {
        entity: "work_session",
        actions: {
          start: {
            action: "start",
            description: "Start a deep-work/deep-study session. Fails if one is already active for this user (application-level invariant, not a DB constraint).",
            patchShape: "{ kind: 'deep_work'|'deep_study' }",
            handler: async (ctx, patch) => {
              const kind = requireEnum(patch, "kind", ["deep_work", "deep_study"] as const);
              const started = await startWorkSessionCore(ctx.userClient, ctx.userId, kind);
              return {
                result: { content: [{ type: "text", text: JSON.stringify(started) }], structuredContent: { id: started.id, updated_at: null, started_at: started.startedAt } },
                summary: `started a ${kind} session`,
              };
            },
          },
          end: {
            action: "end",
            description: "End an active session, stamping ended_at. Requires the top-level id.",
            patchShape: "{}",
            handler: async (ctx) => {
              const id = requireId(ctx);
              await endWorkSessionCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id }) }], structuredContent: { id, updated_at: ctx.now.toISOString() } },
                summary: `ended work session ${id}`,
              };
            },
          },
        },
      },
    },
  },
  business: {
    domain: "business",
    entities: {
      kill_list_item: {
        entity: "kill_list_item",
        actions: {
          set: {
            action: "set",
            description: "Set (create or overwrite) one of a day's 3 kill-list slots. position is the EXPLICIT slot (0/1/2), not an implicit append order.",
            patchShape: "{ date: string, position: 0|1|2, text: string }",
            handler: async (ctx, patch) => {
              const date = requireString(patch, "date");
              const position = requireNumberEnum(patch, "position", [0, 1, 2] as const);
              const text = requireString(patch, "text");
              await setKillListItemCore(ctx.userClient, ctx.userId, date, position, text);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ date, position, text }) }], structuredContent: { id: `${date}:${position}`, updated_at: null, date, position, text } },
                summary: `set kill-list slot ${position} on ${date}`,
              };
            },
          },
          toggle: {
            action: "toggle",
            description: "Toggle a kill-list item's completion. Requires the top-level id.",
            patchShape: "{}",
            handler: async (ctx) => {
              const id = requireId(ctx);
              const result = await toggleKillListItemCore(ctx.userClient, ctx.userId, id);
              return {
                result: { content: [{ type: "text", text: JSON.stringify({ id, ...result }) }], structuredContent: { id, updated_at: null, ...result } },
                summary: `toggled kill-list item ${id} to ${result.completed ? "completed" : "not completed"}`,
              };
            },
          },
        },
      },
      weekly_goal: {
        entity: "weekly_goal",
        actions: {
          save: {
            action: "save",
            description: "Save (upsert) this week's business-domain goal. Plain upsert, no locking/carry-forward — see saveBusinessWeeklyGoalCore's own comment.",
            patchShape: "{ week_start_date: string, headline: string, milestones: string[] }",
            handler: async (ctx, patch) => {
              const weekStartDate = requireString(patch, "week_start_date");
              const headline = requireString(patch, "headline");
              const milestonesRaw = patch.milestones;
              if (!Array.isArray(milestonesRaw) || !milestonesRaw.every((m) => typeof m === "string")) {
                throw new Error("patch.milestones must be an array of strings.");
              }
              await saveBusinessWeeklyGoalCore(ctx.userClient, ctx.userId, weekStartDate, headline, milestonesRaw);
              return {
                result: {
                  content: [{ type: "text", text: JSON.stringify({ week_start_date: weekStartDate, headline }) }],
                  structuredContent: { id: `${weekStartDate}:business`, updated_at: null, week_start_date: weekStartDate, headline },
                },
                summary: `saved business weekly goal for week of ${weekStartDate}`,
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
