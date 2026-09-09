import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDomain, getEntity, type EntityDef } from "../registry";
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

/** Maps one raw row to the uniform `{id, updated_at, ...columns}` output shape — the id/updated_at keys are always THESE names in the response, regardless of the underlying column names (e.g. `logged_at` -> `updated_at`). */
function toItem(def: EntityDef, row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: row[def.idColumn],
    updated_at: def.updatedAtColumn ? row[def.updatedAtColumn] ?? null : null,
  };
  for (const col of columns) {
    if (col !== def.idColumn && col !== def.updatedAtColumn) item[col] = row[col];
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

/** Untyped `SupabaseClient` — see lib/mcp/tool-wrapper.ts's comment on its `fn` parameter for why a registry-driven dynamic table dispatcher can't be typed against the generated `Database` union. */
export async function readTool(supabase: SupabaseClient, userId: string, args: ReadArgs): Promise<RunMcpToolOutcome> {
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
    for (const [col, value] of Object.entries(def.fixedFilter ?? {})) idQuery = idQuery.eq(col, value);
    const { data, error } = await idQuery.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No ${def.entity} found with id "${args.id}".`);

    const item = toItem(def, data as unknown as Record<string, unknown>, columns);
    return {
      result: { content: [{ type: "text", text: JSON.stringify(item) }], structuredContent: item },
      summary: `returned 1 ${def.entity} by id`,
    };
  }

  let query = supabase.from(def.table).select(select, { count: "exact" }).eq("user_id", userId);
  for (const [col, value] of Object.entries(def.fixedFilter ?? {})) query = query.eq(col, value);
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
  const { data, error, count } = await query.range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const items = rows.map((row) => toItem(def, row as unknown as Record<string, unknown>, columns));
  const nextOffset = offset + rows.length;
  const hasMore = count !== null ? nextOffset < count : rows.length === PAGE_SIZE;
  const payload = { items, has_more: hasMore, cursor: hasMore ? encodeCursor(nextOffset) : null };

  return {
    result: { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload },
    summary: `returned ${items.length} ${def.entity}(s)${hasMore ? ", more available" : ""}`,
  };
}
