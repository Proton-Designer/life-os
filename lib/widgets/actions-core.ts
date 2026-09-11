import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataSource, ListDisplay, MetricCardDisplay, ProgressAgainstGoalDisplay, SparklineDisplay, StreakDisplay, WidgetDisplay, WidgetKind, WidgetSlot, WidgetStatus } from "./validate";
import { validateKind } from "./validate";

/**
 * R5 core(supabase, userId, ...) extraction for `mcp_widgets` — same
 * discipline as every other domain's actions-core.ts. Reachable from BOTH
 * `lib/mcp/tools/widget-manage.ts` (the MCP tool) and the cookie-authed
 * Server Action in `app/(app)/widgets/actions.ts` — no duplicated business
 * logic either way.
 *
 * Untyped `SupabaseClient`, not `SupabaseClient<Database>`: `mcp_widgets`
 * doesn't exist in the generated types until
 * docs/ai-connector/WIDGETS-MIGRATION-NEEDED.md is applied — same posture
 * as every registry-driven dynamic table access elsewhere in lib/mcp/.
 *
 * **Delete is two different operations depending on the actor, deliberately:**
 * `archiveWidgetCore` (status -> 'archived') is what `widget_manage`'s MCP
 * "delete" action calls — no MCP tool ever hard-deletes a row (the
 * no-hard-delete guardrail is about the actor, not the operation: an MCP
 * call may originate from a model acting on injected content, so it only
 * ever flips a status, same mechanism as R9's `'unlogged'` prayer status).
 * `deleteWidgetCore` is a REAL DELETE, reserved for the cookie-authed
 * `removeWidget` Server Action — a person removing their own widget from
 * their own dashboard, the same asymmetry PROGRAM-PLAN R9 already draws
 * for `unmarkPrayer`. Both converge on "this widget doesn't render
 * anymore"; nothing downstream can (or needs to) tell them apart.
 */

/** Discriminated on `kind` so `display`'s shape is a compile-time fact of the row, not something callers re-derive with an `as` cast keyed off a sibling field. */
export type WidgetRow =
  | {
      id: string;
      kind: "metric_card";
      title: string;
      data_source: DataSource;
      display: MetricCardDisplay;
      slot: WidgetSlot;
      position: number;
      status: WidgetStatus;
      updated_at: string;
    }
  | {
      id: string;
      kind: "list";
      title: string;
      data_source: DataSource;
      display: ListDisplay;
      slot: WidgetSlot;
      position: number;
      status: WidgetStatus;
      updated_at: string;
    }
  | {
      id: string;
      kind: "progress_against_goal";
      title: string;
      data_source: DataSource;
      display: ProgressAgainstGoalDisplay;
      slot: WidgetSlot;
      position: number;
      status: WidgetStatus;
      updated_at: string;
    }
  | {
      id: string;
      kind: "sparkline";
      title: string;
      data_source: DataSource;
      display: SparklineDisplay;
      slot: WidgetSlot;
      position: number;
      status: WidgetStatus;
      updated_at: string;
    }
  | {
      id: string;
      kind: "streak";
      title: string;
      data_source: DataSource;
      display: StreakDisplay;
      slot: WidgetSlot;
      position: number;
      status: WidgetStatus;
      updated_at: string;
    };

interface RawWidgetRow {
  id: string;
  kind: string;
  title: string;
  data_source: unknown;
  display: unknown;
  slot: string;
  position: number;
  status: string;
  updated_at: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored `display` shapes were already runtime-validated (lib/widgets/validate.ts's `validateDisplay`) at create/update time, before either ever reached this table — the only way a row here fails these shape checks is a direct database edit bypassing the app entirely. Falls back to a safe default rather than throwing, so one tampered row can't take the rest of a user's widget list down with it (render.ts's per-widget try/catch handles the "data_source has gone stale" case; this handles "display has gone stale" the same way, one layer earlier). */
function metricCardDisplayFrom(display: unknown): MetricCardDisplay {
  if (isPlainObject(display) && display.aggregate === "field" && typeof display.field === "string" && display.field) {
    return { aggregate: "field", field: display.field };
  }
  return { aggregate: "count" };
}

function listDisplayFrom(display: unknown): ListDisplay {
  if (isPlainObject(display) && typeof display.titleField === "string" && display.titleField) {
    return {
      titleField: display.titleField,
      subtitleField: typeof display.subtitleField === "string" && display.subtitleField ? display.subtitleField : undefined,
      limit: typeof display.limit === "number" && Number.isInteger(display.limit) && display.limit >= 1 && display.limit <= 10 ? display.limit : 5,
    };
  }
  return { titleField: "id" };
}

/** Same defense-in-depth fallback posture as metricCardDisplayFrom/listDisplayFrom above — a tampered row degrades to a harmless, honest default (count against a goal of 1) rather than throwing. */
function progressAgainstGoalDisplayFrom(display: unknown): ProgressAgainstGoalDisplay {
  if (isPlainObject(display) && typeof display.goal === "number" && Number.isFinite(display.goal) && display.goal > 0) {
    const aggregate = display.aggregate;
    if (isPlainObject(aggregate) && aggregate.type === "sum" && typeof aggregate.field === "string" && aggregate.field) {
      return { aggregate: { type: "sum", field: aggregate.field }, goal: display.goal };
    }
    return { aggregate: { type: "count" }, goal: display.goal };
  }
  return { aggregate: { type: "count" }, goal: 1 };
}

/**
 * Same defense-in-depth fallback posture as the three functions above, with
 * one difference worth stating: there is no universally-safe `dateField`
 * guess (unlike `{aggregate:"count"}`, which needs no column at all). The
 * fallback names `"id"` -- present on every entity -- which at render time
 * fails `bucketDateKey`'s date-parse for every row (a uuid isn't a date),
 * so a tampered row degrades to an honestly EMPTY sparkline, never a crash
 * and never data that could be mistaken for a real trend.
 */
function sparklineDisplayFrom(display: unknown): SparklineDisplay {
  if (isPlainObject(display) && typeof display.dateField === "string" && display.dateField) {
    return {
      dateField: display.dateField,
      valueField: typeof display.valueField === "string" && display.valueField ? display.valueField : undefined,
      days: typeof display.days === "number" && Number.isInteger(display.days) && display.days >= 7 && display.days <= 60 ? display.days : 14,
    };
  }
  return { dateField: "id", days: 14 };
}

/** Same fallback reasoning as sparklineDisplayFrom above -- `dateField:"id"` degrades a tampered row to a streak that can never find a hit (a uuid is never a date), i.e. an honest 0, never a crash or a fabricated number. */
function streakDisplayFrom(display: unknown): StreakDisplay {
  if (isPlainObject(display) && typeof display.dateField === "string" && display.dateField) {
    return { dateField: display.dateField };
  }
  return { dateField: "id" };
}

/**
 * The single place a raw DB row becomes a real `WidgetRow` discriminated
 * union — `kind` is validated once here (via the same `validateKind` used
 * at write time; the DB `CHECK` constraint means this should never fire,
 * but a schema/registry drift is exactly the case worth failing loudly on
 * rather than silently mis-rendering), and `display` is narrowed to
 * exactly the shape that `kind` implies. Every caller downstream (render.ts,
 * widget-manage.ts) gets `row.kind === "metric_card"` narrowing `row.display`
 * to `MetricCardDisplay` for free, through TypeScript's own control-flow
 * analysis — no `as MetricCardDisplay`/`as ListDisplay` cast anywhere else
 * in the widget layer.
 */
function toWidgetRow(raw: RawWidgetRow): WidgetRow {
  const kind = validateKind(raw.kind);
  const common = {
    id: raw.id,
    title: raw.title,
    data_source: raw.data_source as DataSource,
    slot: raw.slot as WidgetSlot,
    position: raw.position,
    status: raw.status as WidgetStatus,
    updated_at: raw.updated_at,
  };
  if (kind === "metric_card") {
    return { ...common, kind, display: metricCardDisplayFrom(raw.display) };
  }
  if (kind === "progress_against_goal") {
    return { ...common, kind, display: progressAgainstGoalDisplayFrom(raw.display) };
  }
  if (kind === "sparkline") {
    return { ...common, kind, display: sparklineDisplayFrom(raw.display) };
  }
  if (kind === "streak") {
    return { ...common, kind, display: streakDisplayFrom(raw.display) };
  }
  return { ...common, kind, display: listDisplayFrom(raw.display) };
}

const WIDGET_ROW_COLUMNS = "id, kind, title, data_source, display, slot, position, status, updated_at";

export interface ListWidgetsOptions {
  /** Include archived (MCP-"deleted") widgets. Default false — archived widgets are neither rendered nor listed by a normal call. */
  includeArchived?: boolean;
}

export async function listWidgetsCore(supabase: SupabaseClient, userId: string, slot?: WidgetSlot, opts: ListWidgetsOptions = {}): Promise<WidgetRow[]> {
  let query = supabase.from("mcp_widgets").select(WIDGET_ROW_COLUMNS).eq("user_id", userId).order("slot", { ascending: true }).order("position", { ascending: true });
  if (slot) query = query.eq("slot", slot);
  if (!opts.includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as RawWidgetRow[]).map(toWidgetRow);
}

export async function getWidgetCore(supabase: SupabaseClient, userId: string, id: string): Promise<WidgetRow | null> {
  const { data, error } = await supabase.from("mcp_widgets").select(WIDGET_ROW_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toWidgetRow(data as unknown as RawWidgetRow);
}

export interface CreateWidgetInput {
  kind: WidgetKind;
  title: string;
  dataSource: DataSource;
  display: WidgetDisplay;
  slot: WidgetSlot;
  /** Server-computed (max(existing for this slot)+1) when omitted — a widget just deliberately added belongs at the end of the user's intentional order, same reasoning as lib/school/actions-core.ts's createClassCore. */
  position?: number;
}

export async function createWidgetCore(supabase: SupabaseClient, userId: string, input: CreateWidgetInput): Promise<string> {
  let position = input.position;
  if (position === undefined) {
    const { data: maxRow, error: maxError } = await supabase
      .from("mcp_widgets")
      .select("position")
      .eq("user_id", userId)
      .eq("slot", input.slot)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;
    position = ((maxRow as { position: number } | null)?.position ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("mcp_widgets")
    .insert({
      user_id: userId,
      kind: input.kind,
      title: input.title,
      data_source: input.dataSource,
      display: input.display,
      slot: input.slot,
      position,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface UpdateWidgetInput {
  title?: string;
  dataSource?: DataSource;
  display?: WidgetDisplay;
  position?: number;
}

export async function updateWidgetCore(supabase: SupabaseClient, userId: string, id: string, input: UpdateWidgetInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.dataSource !== undefined) patch.data_source = input.dataSource;
  if (input.display !== undefined) patch.display = input.display;
  if (input.position !== undefined) patch.position = input.position;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("mcp_widgets").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/** MCP `widget_manage`'s "delete" — see this file's header for why this, not a DELETE, is what an MCP-originated delete does. Idempotent-ish: archiving an already-archived widget is a harmless no-op update. */
export async function archiveWidgetCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("mcp_widgets").update({ status: "archived" }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/** A real DELETE — reserved for the cookie-authed `removeWidget` Server Action. See this file's header for the actor-based reasoning; never call this from `widget-manage.ts`. */
export async function deleteWidgetCore(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("mcp_widgets").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}
