import "server-only";
import { getDomain, getEntity } from "@/lib/mcp/registry";

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

export const WIDGET_KINDS = ["metric_card", "list", "progress_against_goal"] as const;
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

export type WidgetDisplay = MetricCardDisplay | ListDisplay | ProgressAgainstGoalDisplay;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates `data_source` against the registry's own allowlists. Returns the registry's EntityDef-shaped info the caller needs (nothing sensitive — just enough to cross-check `display` against `fullColumns`). */
export function validateDataSource(raw: unknown): { dataSource: DataSource; fullColumns: string[] } {
  if (!isPlainObject(raw)) throw new Error("data_source must be an object: { domain, entity, filter? }.");
  const domain = raw.domain;
  const entity = raw.entity;
  if (typeof domain !== "string" || !domain) throw new Error("data_source.domain is required.");
  if (typeof entity !== "string" || !entity) throw new Error("data_source.entity is required.");

  const domainDef = getDomain(domain);
  if (!domainDef) throw new Error(`Unknown domain "${domain}" in data_source. Call list_capabilities() for the valid set.`);
  const entityDef = getEntity(domain, entity);
  if (!entityDef) {
    const known = Object.keys(domainDef.entities);
    throw new Error(`Unknown entity "${entity}" for domain "${domain}" in data_source. Known entities: ${known.join(", ") || "(none yet)"}.`);
  }

  let filter: Record<string, string | number | boolean> | undefined;
  if (raw.filter !== undefined) {
    if (!isPlainObject(raw.filter)) throw new Error("data_source.filter must be an object.");
    for (const [col, value] of Object.entries(raw.filter)) {
      if (!entityDef.filterableColumns.includes(col)) {
        throw new Error(`data_source.filter references "${col}", which is not filterable on entity "${entity}". Filterable: ${entityDef.filterableColumns.join(", ")}.`);
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error(`data_source.filter.${col} must be a string, number, or boolean.`);
      }
    }
    filter = raw.filter as Record<string, string | number | boolean>;
  }

  // parentFilter entities (e.g. school.schedule_event_override) are ALWAYS
  // read scoped to one named parent — a widget built against one without
  // the required filter column would fail at EVERY render, not just look
  // wrong. Caught here, at creation, not discovered later on the Home page.
  if (entityDef.parentFilter && !filter?.[entityDef.parentFilter.column]) {
    throw new Error(`Entity "${entity}" requires data_source.filter.${entityDef.parentFilter.column} — it is always read scoped to one parent, never as an unscoped list.`);
  }

  return { dataSource: { domain, entity, filter }, fullColumns: entityDef.fullColumns };
}

function validateProgressAggregate(raw: unknown, fullColumns: string[]): ProgressAggregate {
  if (!isPlainObject(raw)) throw new Error("display.aggregate must be an object: { type: 'count' } or { type: 'sum', field }.");
  if (raw.type === "count") return { type: "count" };
  if (raw.type === "sum") {
    const field = raw.field;
    if (typeof field !== "string" || !field) throw new Error("display.aggregate.field is required when display.aggregate.type is 'sum'.");
    if (!fullColumns.includes(field)) throw new Error(`display.aggregate.field "${field}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
    return { type: "sum", field };
  }
  throw new Error("display.aggregate.type must be 'count' or 'sum' for a progress_against_goal widget.");
}

/** Validates `display` against `kind` and the data source entity's own `fullColumns` (so a field a widget wants to show is guaranteed selectable at render time). */
export function validateDisplay(kind: WidgetKind, raw: unknown, fullColumns: string[]): WidgetDisplay {
  if (!isPlainObject(raw)) throw new Error("display must be an object.");

  if (kind === "metric_card") {
    const aggregate = raw.aggregate;
    if (aggregate === "count") return { aggregate: "count" };
    if (aggregate === "field") {
      const field = raw.field;
      if (typeof field !== "string" || !field) throw new Error("display.field is required when display.aggregate is 'field'.");
      if (!fullColumns.includes(field)) throw new Error(`display.field "${field}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
      return { aggregate: "field", field };
    }
    throw new Error("display.aggregate must be 'count' or 'field' for a metric_card widget.");
  }

  if (kind === "progress_against_goal") {
    const aggregate = validateProgressAggregate(raw.aggregate, fullColumns);
    const goal = raw.goal;
    if (typeof goal !== "number" || !Number.isFinite(goal) || goal <= 0) {
      throw new Error("display.goal is required and must be a positive number for a progress_against_goal widget.");
    }
    return { aggregate, goal };
  }

  // kind === "list"
  const titleField = raw.titleField;
  if (typeof titleField !== "string" || !titleField) throw new Error("display.titleField is required for a list widget.");
  if (!fullColumns.includes(titleField)) throw new Error(`display.titleField "${titleField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);

  let subtitleField: string | undefined;
  if (raw.subtitleField !== undefined) {
    if (typeof raw.subtitleField !== "string" || !raw.subtitleField) throw new Error("display.subtitleField must be a non-empty string.");
    if (!fullColumns.includes(raw.subtitleField)) throw new Error(`display.subtitleField "${raw.subtitleField}" is not a column on this widget's data source entity. Available: ${fullColumns.join(", ")}.`);
    subtitleField = raw.subtitleField;
  }

  let limit = 5;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 10) {
      throw new Error("display.limit must be an integer between 1 and 10.");
    }
    limit = raw.limit;
  }

  return { titleField, subtitleField, limit };
}

export function validateKind(raw: unknown): WidgetKind {
  if (typeof raw !== "string" || !(WIDGET_KINDS as readonly string[]).includes(raw)) {
    throw new Error(`kind must be one of: ${WIDGET_KINDS.join(", ")}. Got: ${JSON.stringify(raw)}.`);
  }
  return raw as WidgetKind;
}

export function validateSlot(raw: unknown): WidgetSlot {
  if (raw === undefined) return "home";
  if (typeof raw !== "string" || !(WIDGET_SLOTS as readonly string[]).includes(raw)) {
    throw new Error(`slot must be one of: ${WIDGET_SLOTS.join(", ")}. Got: ${JSON.stringify(raw)}.`);
  }
  return raw as WidgetSlot;
}
