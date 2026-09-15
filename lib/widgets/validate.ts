import "server-only";
import { getDomain, getEntity, type EntityDef } from "@/lib/mcp/registry";
// Every rule in this file validates CALLER input against registry-static
// allowlists, and every message names only those static sets plus the
// caller's own value — so each throws ToolInputError and reaches the MCP
// client verbatim (P4-01). A caller validating a value READ FROM THE
// DATABASE must demote these to a plain Error (see widget-manage.ts's
// validateStored and actions-core.ts's toWidgetRow).
import { ToolInputError } from "@/lib/mcp/tool-input-error";

/**
 * Validates a widget's `data_source`/`display` BEFORE it's ever stored —
 * the structural guarantee the lead asked for: "a widget's data source can
 * only reference entities the read registry already exposes... must never
 * be a way to read source_chunks.text." This is write-time defense in
 * depth; `lib/widgets/render.ts` calls the real `readTool()` at render
 * time too, which enforces the SAME allowlists independently (fixedFilter/
 * parentFilter/fullColumns) — a widget whose data_source somehow slipped
 * past this validator (a future bug here, a row edited directly in the
 * database) still cannot read anything `read()` itself wouldn't return.
 * Two layers, not one, on purpose.
 */

export const WIDGET_KINDS = ["metric_card", "list", "progress_against_goal", "sparkline", "streak"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WIDGET_SLOTS = ["home"] as const;
export type WidgetSlot = (typeof WIDGET_SLOTS)[number];

/**
 * `'archived'` is the MCP-facing "delete" per the standing no-hard-delete
 * rule (PROGRAM-PLAN R9's `'unlogged'` precedent, same reasoning applied
 * here): an MCP-originated delete can't be trusted to be the account
 * owner's own intent (it may be a model acting on injected content), so it
 * only ever flips a status. The cookie-authed Server Action
 * (`app/(app)/widgets/actions.ts`) is a human clicking remove on their own
 * dashboard and keeps a real DELETE, same asymmetry as `unmarkPrayer`.
 */
export const WIDGET_STATUSES = ["active", "archived"] as const;
export type WidgetStatus = (typeof WIDGET_STATUSES)[number];

export interface DataSource {
  domain: string;
  entity: string;
  filter?: Record<string, string | number | boolean>;
}

export type MetricCardDisplay = { aggregate: "count" } | { aggregate: "field"; field: string };
export interface ListDisplay {
  titleField: string;
  subtitleField?: string;
  limit?: number;
}

/**
 * R11's first extended-vocabulary kind (PROGRAM-PLAN.md) — "derived values
 * over allowlisted columns," scoped deliberately to ONE data source per the
 * lead's "land one kind end-to-end before starting the next" instruction.
 * `goal` is a static number set on the widget itself, not pulled from a
 * second entity (e.g. `business.weekly_goal.quran_page_target`) — that's
 * the natural next increment once multi-source widgets land, not this one.
 *
 * `aggregate: { type: "sum", field }` is computed CLIENT-SIDE in render.ts
 * over the rows `readTool()` already returned — never a second query, same
 * "derived, not re-fetched" rule every other aggregate in this layer
 * follows. Because `readTool` pages at 20 rows, a sum over more than 20
 * matching rows is a FLOOR, not an exact total — render.ts reports this
 * honestly (a "+" suffix) the same way metric_card's `count` aggregate
 * already does for `has_more`, never silently wrong.
 */
export type ProgressAggregate = { type: "count" } | { type: "sum"; field: string };
export interface ProgressAgainstGoalDisplay {
  aggregate: ProgressAggregate;
  goal: number;
}

/**
 * R12's kind (PROGRAM-PLAN.md) — the first of the two time-series kinds R12
 * exists to unblock. `dateField` is the column to bucket rows into local
 * calendar days by; `valueField` (omitted -> count rows per day, present ->
 * sum that numeric column per day) is derived CLIENT-SIDE in render.ts over
 * the rows `readTool()` returned, same "never a second query" rule as
 * progress_against_goal's `sum` aggregate.
 *
 * `dateField` MUST be the data source entity's own PRIMARY sort column, in
 * DESCENDING order — enforced in `validateDataSource`'s `orderBy` check
 * below, not left as a documented assumption. Why: `render.ts` fetches up
 * to `WIDGET_RENDER_MAX_ROWS` rows, ordered by whatever the entity's own
 * registered `orderBy` says (unchanged by R12 — "nothing else moves").
 * If that order were ascending, the fetched page would be the OLDEST rows,
 * not the most recent, and a "trailing N days" sparkline would silently
 * show a stale or empty window — precisely the "looks plausible, is wrong"
 * failure the lead flagged, just one layer earlier than the chart itself.
 * Every entity in the registry with a date-shaped `orderBy` already sorts
 * descending (verified at audit time, not assumed), so this check costs
 * nothing for any entity sparkline is actually useful against — it only
 * ever fires for a genuinely wrong `dateField` choice.
 *
 * MEASURED, not guessed, once the lead asked what this guard actually
 * blocks (positive-controlled scan over all 57 registered entities): 30
 * eligible (primary sort is a date column, descending — exactly the "how
 * am I doing over time" surfaces: prayer, quran_session, habit_log,
 * work_session, kill_list_item, class_assessment, workout_session,
 * body_metric, self_mastery.review...), 4 blocked (`school.task.due_date`,
 * `school.schedule_event_override.date`,
 * `school.schedule_event_cancellation.date`,
 * `self_mastery.card_state.due_at`), 23 with no usable date primary at all.
 * The 4 blocked ones sort ASCENDING because they are forward-looking —
 * due dates, upcoming events, cards due next — and a "trailing N days"
 * chart of a due-date column isn't a trend, it's a forecast wearing a
 * trend's costume. The guard isn't an arbitrary restriction that happens
 * to be safe; the ascending sort IS the signal that a column means "about
 * the future," and blocking on it blocks exactly the right set.
 *
 * If a forward-looking chart is ever wanted (a forecast/upcoming-load
 * bar for due dates or upcoming events), that is a DIFFERENT kind to
 * build — never this one with the guard relaxed. Relaxing it here would
 * let a sparkline draw a confident-looking line through data it
 * fundamentally cannot represent correctly.
 */
export interface SparklineDisplay {
  dateField: string;
  valueField?: string;
  /** Trailing days to show, inclusive of today. Default 14; clamped 7-60 so WIDGET_RENDER_MAX_ROWS (100) stays comfortably ahead of daily granularity even on a busy entity. */
  days?: number;
}

/**
 * R12's second kind — the other time-series surface the raised row limit
 * exists to unblock. Consecutive DAYS (not rows) with at least one
 * matching row, walking backward from today. "Matching" is whatever
 * `data_source.filter` already narrows to (e.g. `{completed: true}` for a
 * habit's own completion streak) — streak itself adds no second filtering
 * concept, it only asks "was there a hit on day X," reusing the exact
 * mechanism every other kind already uses to narrow rows.
 *
 * Same `dateField`-must-be-primary-descending-sort guard as sparkline, and
 * for the identical reason: `render.ts` fetches up to
 * `WIDGET_RENDER_MAX_ROWS` rows ordered by the entity's own `orderBy`, and
 * a streak walk needs those to be the MOST RECENT rows to be counting the
 * right end of history.
 */
export interface StreakDisplay {
  dateField: string;
}

export type WidgetDisplay = MetricCardDisplay | ListDisplay | ProgressAgainstGoalDisplay | SparklineDisplay | StreakDisplay;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates `data_source` against the registry's own allowlists. Returns the registry's EntityDef-shaped info the caller needs (nothing sensitive — just enough to cross-check `display` against `fullColumns`/`orderBy`). */
export function validateDataSource(raw: unknown): { dataSource: DataSource; fullColumns: string[]; orderBy: EntityDef["orderBy"] } {
  if (!isPlainObject(raw)) throw new ToolInputError("data_source must be an object: { domain, entity, filter? }.");
  const domain = raw.domain;
  const entity = raw.entity;
  if (typeof domain !== "string" || !domain) throw new ToolInputError("data_source.domain is required.");
  if (typeof entity !== "string" || !entity) throw new ToolInputError("data_source.entity is required.");

  const domainDef = getDomain(domain);
  if (!domainDef) throw new ToolInputError(`Unknown domain "${domain}" in data_source. Call list_capabilities() for the valid set.`);
  const entityDef = getEntity(domain, entity);
  if (!entityDef) {
    const known = Object.keys(domainDef.entities);
    throw new ToolInputError(`Unknown entity "${entity}" for domain "${domain}" in data_source. Known entities: ${known.join(", ") || "(none yet)"}.`);
  }

  let filter: Record<string, string | number | boolean> | undefined;
  if (raw.filter !== undefined) {
    if (!isPlainObject(raw.filter)) throw new ToolInputError("data_source.filter must be an object.");
    for (const [col, value] of Object.entries(raw.filter)) {
      if (!entityDef.filterableColumns.includes(col)) {
        throw new ToolInputError(`data_source.filter references "${col}", which is not filterable on entity "${entity}". Filterable: ${entityDef.filterableColumns.join(", ")}.`);
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new ToolInputError(`data_source.filter.${col} must be a string, number, or boolean.`);
      }
    }
    filter = raw.filter as Record<string, string | number | boolean>;
  }

  // parentFilter entities (e.g. school.schedule_event_override) are ALWAYS
  // read scoped to one named parent — a widget built against one without
  // the required filter column would fail at EVERY render, not just look
  // wrong. Caught here, at creation, not discovered later on the Home page.
  if (entityDef.parentFilter && !filter?.[entityDef.parentFilter.column]) {
    throw new ToolInputError(`Entity "${entity}" requires data_source.filter.${entityDef.parentFilter.column} — it is always read scoped to one parent, never as an unscoped list.`);
  }

  return { dataSource: { domain, entity, filter }, fullColumns: entityDef.fullColumns, orderBy: entityDef.orderBy };
}

function validateProgressAggregate(raw: unknown, fullColumns: string[]): ProgressAggregate {
  if (!isPlainObject(raw)) throw new ToolInputError("display.aggregate must be an object: { type: 'count' } or { type: 'sum', field }.");
  if (raw.type === "count") return { type: "count" };
  if (raw.type === "sum") {
    const field = raw.field;
    if (typeof field !== "string" || !field) throw new ToolInputError("display.aggregate.field is required when display.aggregate.type is 'sum'.");
    if (!fullColumns.includes(field)) throw new ToolInputError(`display.aggregate.field "${field}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
    return { type: "sum", field };
  }
  throw new ToolInputError("display.aggregate.type must be 'count' or 'sum' for a progress_against_goal widget.");
}

function validateListDisplay(raw: Record<string, unknown>, fullColumns: string[]): ListDisplay {
  const titleField = raw.titleField;
  if (typeof titleField !== "string" || !titleField) throw new ToolInputError("display.titleField is required for a list widget.");
  if (!fullColumns.includes(titleField)) throw new ToolInputError(`display.titleField "${titleField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);

  let subtitleField: string | undefined;
  if (raw.subtitleField !== undefined) {
    if (typeof raw.subtitleField !== "string" || !raw.subtitleField) throw new ToolInputError("display.subtitleField must be a non-empty string.");
    if (!fullColumns.includes(raw.subtitleField)) throw new ToolInputError(`display.subtitleField "${raw.subtitleField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
    subtitleField = raw.subtitleField;
  }

  let limit = 5;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 10) {
      throw new ToolInputError("display.limit must be an integer between 1 and 10.");
    }
    limit = raw.limit;
  }

  return { titleField, subtitleField, limit };
}

/**
 * Shared by sparkline and streak — both fetch up to `WIDGET_RENDER_MAX_ROWS`
 * rows ordered by the entity's own registered `orderBy`, so both need that
 * order to actually be "most recent first" along the column they bucket by.
 * `kindLabel` only changes the error message's wording, not the check.
 */
function validateDateFieldIsPrimaryDescendingSort(dateField: string, fullColumns: string[], orderBy: EntityDef["orderBy"], kindLabel: string): void {
  if (!fullColumns.includes(dateField)) throw new ToolInputError(`display.dateField "${dateField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
  const primarySort = orderBy[0];
  if (!primarySort || primarySort.column !== dateField || primarySort.ascending !== false) {
    throw new ToolInputError(
      `A ${kindLabel}'s dateField must be this entity's own primary sort column, descending (so the most recent rows are the ones fetched) -- "${dateField}" isn't. This entity's own order is: ${orderBy.map((o) => `${o.column} ${o.ascending ? "asc" : "desc"}`).join(", ") || "(none)"}.`,
    );
  }
}

function validateStreakDisplay(raw: Record<string, unknown>, fullColumns: string[], orderBy: EntityDef["orderBy"]): StreakDisplay {
  const dateField = raw.dateField;
  if (typeof dateField !== "string" || !dateField) throw new ToolInputError("display.dateField is required for a streak widget.");
  validateDateFieldIsPrimaryDescendingSort(dateField, fullColumns, orderBy, "streak");
  return { dateField };
}

function validateSparklineDisplay(raw: Record<string, unknown>, fullColumns: string[], orderBy: EntityDef["orderBy"]): SparklineDisplay {
  const dateField = raw.dateField;
  if (typeof dateField !== "string" || !dateField) throw new ToolInputError("display.dateField is required for a sparkline widget.");
  validateDateFieldIsPrimaryDescendingSort(dateField, fullColumns, orderBy, "sparkline");

  let valueField: string | undefined;
  if (raw.valueField !== undefined) {
    if (typeof raw.valueField !== "string" || !raw.valueField) throw new ToolInputError("display.valueField must be a non-empty string.");
    if (!fullColumns.includes(raw.valueField)) throw new ToolInputError(`display.valueField "${raw.valueField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
    valueField = raw.valueField;
  }

  let days = 14;
  if (raw.days !== undefined) {
    if (typeof raw.days !== "number" || !Number.isInteger(raw.days) || raw.days < 7 || raw.days > 60) {
      throw new ToolInputError("display.days must be an integer between 7 and 60.");
    }
    days = raw.days;
  }

  return { dateField, valueField, days };
}

/** Validates `display` against `kind` and the data source entity's own `fullColumns`/`orderBy` (so a field a widget wants to show is guaranteed selectable, and a sparkline's date bucketing is guaranteed to cover the right window, at render time). */
export function validateDisplay(kind: WidgetKind, raw: unknown, fullColumns: string[], orderBy: EntityDef["orderBy"]): WidgetDisplay {
  if (!isPlainObject(raw)) throw new ToolInputError("display must be an object.");

  if (kind === "metric_card") {
    const aggregate = raw.aggregate;
    if (aggregate === "count") return { aggregate: "count" };
    if (aggregate === "field") {
      const field = raw.field;
      if (typeof field !== "string" || !field) throw new ToolInputError("display.field is required when display.aggregate is 'field'.");
      if (!fullColumns.includes(field)) throw new ToolInputError(`display.field "${field}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
      return { aggregate: "field", field };
    }
    throw new ToolInputError("display.aggregate must be 'count' or 'field' for a metric_card widget.");
  }

  if (kind === "progress_against_goal") {
    const aggregate = validateProgressAggregate(raw.aggregate, fullColumns);
    const goal = raw.goal;
    if (typeof goal !== "number" || !Number.isFinite(goal) || goal <= 0) {
      throw new ToolInputError("display.goal is required and must be a positive number for a progress_against_goal widget.");
    }
    return { aggregate, goal };
  }

  if (kind === "sparkline") {
    return validateSparklineDisplay(raw, fullColumns, orderBy);
  }

  if (kind === "streak") {
    return validateStreakDisplay(raw, fullColumns, orderBy);
  }

  // kind === "list"
  return validateListDisplay(raw, fullColumns);
}

export function validateKind(raw: unknown): WidgetKind {
  if (typeof raw !== "string" || !(WIDGET_KINDS as readonly string[]).includes(raw)) {
    throw new ToolInputError(`kind must be one of: ${WIDGET_KINDS.join(", ")}. Got: ${JSON.stringify(raw)}.`);
  }
  return raw as WidgetKind;
}

export function validateSlot(raw: unknown): WidgetSlot {
  if (raw === undefined) return "home";
  if (typeof raw !== "string" || !(WIDGET_SLOTS as readonly string[]).includes(raw)) {
    throw new ToolInputError(`slot must be one of: ${WIDGET_SLOTS.join(", ")}. Got: ${JSON.stringify(raw)}.`);
  }
  return raw as WidgetSlot;
}
