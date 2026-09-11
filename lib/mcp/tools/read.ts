import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDomain, getEntity, type EntityDef, type FixedFilterValue } from "../registry";
import type { RunMcpToolOutcome } from "../tool-wrapper";

/**
 * `read(domain, entity, id?, filter?, detail?, fields?, cursor?)` —
 * TOOL-ARCHITECTURE.md §3/§5's single read dispatcher. L3 wires exactly
 * `domain:"deen"`, `entity:"prayer"` (see lib/mcp/registry.ts's own header
 * for why only that one, and why not more were rushed in this pass).
 *
 * `detail`/`fields` narrow WITHIN an entity's `fullColumns` registry entry,
 * never past it (memo §3) — this is enforced here, not left to trust: a
 * `fields` request naming a column outside `fullColumns` is a rejected
 * call, not a silently-trimmed one, the same posture `lib/ai/providers.ts`'s
 * `validateKeyShape` takes on a malformed key (reject loudly, don't guess).
 */

export type ReadDetail = "ids" | "summary" | "full";
const PAGE_SIZE = 20;

/**
 * R12 (PROGRAM-PLAN.md): the 20-row page cap is a MODEL-CONTEXT constraint
 * (R8) — it exists because every row a TOOL returns is spent in a model's
 * context window. `renderWidgets` (lib/widgets/render.ts) has exactly one
 * caller, the server-rendered Home page, so its output never reaches a
 * model's context at all; R8's reasoning doesn't transfer to it.
 *
 * `options` is DELIBERATELY a separate parameter from `args` — `args` is
 * the MCP-facing shape (`ReadArgs`), built from whatever a model/widget
 * definition supplies, and `maxRows` must never be reachable through it.
 * `app/api/mcp/route.ts` calls `readTool(client, userId, args)` — three
 * arguments, no fourth — so the MCP route's page size is PAGE_SIZE=20,
 * unconditionally, with no code path by which a caller-supplied value
 * could reach it. Only `lib/widgets/render.ts` passes `options.maxRows`,
 * and only as its own named constant (`WIDGET_RENDER_MAX_ROWS`) — never a
 * value read from a widget's `data_source`/`display`.
 */
export interface ReadToolOptions {
  /** Overrides PAGE_SIZE for this call only. See this file's own note above — never derived from `args`. */
  maxRows?: number;
}

export interface ReadArgs {
  domain: string;
  entity: string;
  id?: string;
  filter?: Record<string, string | number | boolean>;
  detail?: ReadDetail;
  fields?: string[];
  cursor?: string;
}

function resolveEntity(domain: string, entity: string): EntityDef {
  const domainDef = getDomain(domain);
  if (!domainDef) {
    throw new Error(`Unknown domain "${domain}". Call list_capabilities() for the valid set.`);
  }
  const entityDef = getEntity(domain, entity);
  if (!entityDef) {
    const known = Object.keys(domainDef.entities);
    throw new Error(
      `Unknown entity "${entity}" for domain "${domain}". Known entities: ${known.join(", ") || "(none yet)"}. ` +
        `Call list_capabilities("${domain}") for the valid set.`,
    );
  }
  return entityDef;
}

/** The columns to SELECT for this call — never wider than `def.fullColumns` (the entity's own maximal allowlist), regardless of what `fields` asks for. */
function resolveColumns(def: EntityDef, detail: ReadDetail, fields?: string[]): string[] {
  if (detail === "ids") return []; // the absolute floor — id/updated_at only, fields does not widen this tier
  const base = detail === "summary" ? def.summaryColumns : def.fullColumns;
  if (!fields || fields.length === 0) return base;

  const maximal = new Set(def.fullColumns);
  const invalid = fields.filter((f) => !maximal.has(f));
  if (invalid.length > 0) {
    throw new Error(
      `Field(s) not available for entity "${def.entity}": ${invalid.join(", ")}. ` +
        `Available: ${def.fullColumns.join(", ")}.`,
    );
  }
  return fields;
}

function selectClause(def: EntityDef, columns: string[]): string {
  const set = new Set<string>([def.idColumn, ...(def.updatedAtColumn ? [def.updatedAtColumn] : []), ...columns]);
  return Array.from(set).join(", ");
}

/**
 * `def.truncateColumns`, enforced HERE — the one place every response for
 * this entity passes through, regardless of `detail`/`fields` or which
 * write path (or provider, or future provider) put the value there. A
 * string longer than the configured max is cut to that length and marked
 * with a trailing "…" so a caller can tell the value was shortened, never
 * silently. Non-string values (shouldn't occur for a text column, but this
 * is defense-in-depth, not a type assertion) pass through unchanged.
 */
function applyTruncation(def: EntityDef, col: string, value: unknown): unknown {
  const max = def.truncateColumns?.[col];
  if (!max || typeof value !== "string" || value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/** Maps one raw row to the uniform `{id, updated_at, ...columns}` output shape — the id/updated_at keys are always THESE names in the response, regardless of the underlying column names (e.g. `logged_at` -> `updated_at`). */
function toItem(def: EntityDef, row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: row[def.idColumn],
    updated_at: def.updatedAtColumn ? row[def.updatedAtColumn] ?? null : null,
  };
  for (const col of columns) {
    if (col !== def.idColumn && col !== def.updatedAtColumn) item[col] = applyTruncation(def, col, row[col]);
  }
  return item;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function isNullDiscriminant(value: FixedFilterValue): value is { is: null } {
  return typeof value === "object" && value !== null && "is" in value && value.is === null;
}

/**
 * Applies one entity's `fixedFilter` map to a query — `.eq(col, value)` for
 * a plain equality target, `.is(col, null)` for an explicit `{ is: null }`
 * discriminant (registry.ts's `FixedFilterValue`). Deliberately NEVER
 * `.eq(col, null)`: PostgREST reads that as `col = NULL`, which SQL always
 * evaluates false, not `col IS NULL` — the exact gotcha that made a plain
 * equality-only fixedFilter unable to express `tasks.domain IS NULL`
 * (review.night_plan_task) or migration 108's `checkin_allocations.domain
 * IS NULL` sentinel before this existed. Shared by both the id-lookup and
 * list paths below so the two can never drift on which operator a given
 * discriminant shape uses.
 */
function applyFixedFilter<Q extends { eq(column: string, value: unknown): Q; is(column: string, value: null): Q }>(
  query: Q,
  fixedFilter: Record<string, FixedFilterValue> | undefined,
): Q {
  let q = query;
  for (const [col, value] of Object.entries(fixedFilter ?? {})) {
    q = isNullDiscriminant(value) ? q.is(col, null) : q.eq(col, value);
  }
  return q;
}

/**
 * The resolved operation (migration 131's `mcp_audit_log.operation`) for
 * this call — e.g. "deen.prayer.read" — computed from the raw args BEFORE
 * dispatch, so even an args-only validation failure still logs what was
 * attempted. Exported so route.ts can pass it into `runMcpTool` ahead of
 * actually running the tool.
 */
export function resolveReadOperation(args: ReadArgs): string {
  return `${args.domain}.${args.entity}.read`;
}

/**
 * Verifies a `parentFilter`-bearing entity's named parent row actually
 * belongs to this user and passes `parentFixedFilter` — see EntityDef's
 * own comment on `parentFilter` for why (closing the gap `fixedFilter`
 * leaves open for a child table with no domain/ownership column of its
 * own). Throws "not found" rather than a distinguishable "wrong domain"
 * error, same posture `fixedFilter` uses everywhere else.
 */
async function verifyParent(supabase: SupabaseClient, userId: string, def: EntityDef, parentId: string): Promise<void> {
  const pf = def.parentFilter;
  if (!pf) return;
  let q = supabase.from(pf.parentTable).select(pf.parentIdColumn).eq(pf.parentIdColumn, parentId).eq("user_id", userId);
  for (const [col, value] of Object.entries(pf.parentFixedFilter ?? {})) q = q.eq(col, value);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(`No parent ${pf.parentTable} row found for ${def.entity}.${pf.column} = "${parentId}" (or it doesn't belong to you).`);
  }
}

/** Untyped `SupabaseClient` — see lib/mcp/tool-wrapper.ts's comment on its `fn` parameter for why a registry-driven dynamic table dispatcher can't be typed against the generated `Database` union. */
export async function readTool(supabase: SupabaseClient, userId: string, args: ReadArgs, options?: ReadToolOptions): Promise<RunMcpToolOutcome> {
  const pageSize = options?.maxRows ?? PAGE_SIZE;
  const def = resolveEntity(args.domain, args.entity);
  const detail: ReadDetail = args.detail ?? "summary";
  if (detail !== "ids" && detail !== "summary" && detail !== "full") {
    throw new Error(`Invalid detail "${detail}". Must be one of: ids, summary, full.`);
  }
  const columns = resolveColumns(def, detail, args.fields);
  const select = selectClause(def, columns);

  if (args.id) {
    // Belt-and-suspenders .eq("user_id", userId) on top of RLS — same
    // convention as lib/mcp/tools/get-profile.ts, for the same reason
    // (this codebase's own RLS-sweep incident history).
    let idQuery = supabase.from(def.table).select(select).eq(def.idColumn, args.id).eq("user_id", userId);
    idQuery = applyFixedFilter(idQuery, def.fixedFilter);
    const { data, error } = await idQuery.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No ${def.entity} found with id "${args.id}".`);

    // parentFilter, id-path: the row is already this user's own (checked
    // above), but a child table with no domain column of its own (e.g.
    // schedule_event_overrides) could still point at a PARENT belonging to
    // the wrong MCP domain -- verify using the fetched row's own column,
    // not a caller-supplied filter, so this can't be bypassed by omitting
    // `filter` on an id-based call.
    if (def.parentFilter) {
      const parentId = (data as unknown as Record<string, unknown>)[def.parentFilter.column];
      if (typeof parentId !== "string" || !parentId) {
        throw new Error(`No ${def.entity} found with id "${args.id}".`);
      }
      await verifyParent(supabase, userId, def, parentId);
    }

    const item = toItem(def, data as unknown as Record<string, unknown>, columns);
    return {
      result: { content: [{ type: "text", text: JSON.stringify(item) }], structuredContent: item },
      summary: `returned 1 ${def.entity} by id`,
    };
  }

  // parentFilter, list-path: required, not optional -- an unscoped "every
  // row across every parent" list is refused outright, never silently
  // returned. Verified BEFORE the list query runs, same reasoning as the
  // id-path above.
  if (def.parentFilter) {
    const parentId = args.filter?.[def.parentFilter.column];
    if (typeof parentId !== "string" || !parentId) {
      throw new Error(`Entity "${def.entity}" requires filter.${def.parentFilter.column} — it is always read scoped to one parent, never as an unscoped list.`);
    }
    await verifyParent(supabase, userId, def, parentId);
  }

  let query = supabase.from(def.table).select(select, { count: "exact" }).eq("user_id", userId);
  query = applyFixedFilter(query, def.fixedFilter);
  if (args.filter) {
    for (const [col, value] of Object.entries(args.filter)) {
      if (!def.filterableColumns.includes(col)) {
        throw new Error(`Field "${col}" is not filterable on entity "${def.entity}". Filterable: ${def.filterableColumns.join(", ")}.`);
      }
      query = query.eq(col, value);
    }
  }
  for (const { column, ascending } of def.orderBy) query = query.order(column, { ascending });

  const offset = decodeCursor(args.cursor);
  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const items = rows.map((row) => toItem(def, row as unknown as Record<string, unknown>, columns));
  const nextOffset = offset + rows.length;
  const hasMore = count !== null ? nextOffset < count : rows.length === pageSize;
  const payload = { items, has_more: hasMore, cursor: hasMore ? encodeCursor(nextOffset) : null };

  return {
    result: { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    summary: `returned ${items.length} ${def.entity}(s)${hasMore ? ", more available" : ""}`,
  };
}
