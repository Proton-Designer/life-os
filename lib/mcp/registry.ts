import "server-only";

/**
 * The internal dispatch table Eng2's TOOL-ARCHITECTURE.md (§3, §5) calls for:
 * the single source of truth `list_capabilities` describes and `read`
 * dispatches against. L3 populates exactly one domain (`deen`) with exactly
 * one entity (`prayer`) — "the dispatch table matters more than the
 * coverage; L5 fans it out" (team-lead). Adding a second entity, or a
 * second domain, is adding another object to these maps, never a new code
 * path — that extensibility IS the proof this architecture works, not
 * something to demonstrate by rushing more entities in before each one's
 * been checked the way `prayer` was below.
 *
 * EVERY ENTITY'S COLUMN LISTS ARE A VISIBILITY REGISTRY, not a convenience
 * projection (memo §3): `detail`/`fields` narrow within `fullColumns`, they
 * never widen past it. A column absent from `fullColumns` is not reachable
 * by this entity no matter what the caller asks for — that is the
 * mechanism that keeps e.g. a future `user_api_keys` entity's
 * `encrypted_key` off MCP without trusting every future caller to remember
 * to ask nicely.
 */

export interface EntityDef {
  /** The entity name as used in `read(domain, entity, ...)` — e.g. "prayer". */
  entity: string;
  table: string;
  description: string;
  idColumn: string;
  /**
   * The REAL "last modified" source for this row, or `null` when the
   * table genuinely has no such column and none should be invented.
   *
   * FOUND DURING THIS BUILD, NOT ASSUMED: TOOL-ARCHITECTURE.md's "`updated_at`
   * on every entity, no exceptions" is a design rule, not yet a fact about
   * the schema — grepped the full baseline + every migration and found
   * a genuine, trigger-maintained `updated_at` on exactly ONE table in the
   * entire 68-table schema (`ingestion_jobs`, migration 074's
   * `touch_updated_at()` trigger). None of `deen`'s 8 tables has one.
   * `prayers.logged_at` is used here as `prayer`'s stand-in ONLY because it
   * was verified, not assumed, to be a faithful proxy: `markPrayer`
   * (app/(app)/deen/actions.ts) is the table's ONLY write path and sets
   * `logged_at` on every upsert; `unmarkPrayer` deletes the row outright
   * rather than leaving a stale one. A future entity must not copy this
   * column name by pattern-matching — it must be verified the same way,
   * table by table, or left `null` here honestly. A fabricated
   * `updated_at` would silently break `detail:"ids"`'s entire reuse
   * promise (a row that changed would read as unchanged forever), which is
   * a worse failure than admitting the column doesn't exist.
   */
  updatedAtColumn: string | null;
  /** Returned at `detail:"summary"` (plus id/updated_at, always forced — see readTool). */
  summaryColumns: string[];
  /** Returned at `detail:"full"` — the maximal projection this entity will EVER return, including to `fields`. Must be a superset of summaryColumns. */
  fullColumns: string[];
  /** Columns `filter` may reference. Never `fullColumns` by default — an allowlist, so a caller can't filter on a column that isn't even selectable. */
  filterableColumns: string[];
  /** Default sort, applied for deterministic pagination. Always includes the id column as a tiebreaker. */
  orderBy: { column: string; ascending: boolean }[];
}

export interface DomainDef {
  domain: string;
  description: string;
  entities: Record<string, EntityDef>;
}

export const REGISTRY: Record<string, DomainDef> = {
  deen: {
    domain: "deen",
    description: "Prayer tracking and related worship habits.",
    entities: {
      prayer: {
        entity: "prayer",
        table: "prayers",
        description: "One prayer's logged status for one date (fajr/dhuhr/asr/maghrib/isha; on_time/qada/missed/pending).",
        idColumn: "id",
        updatedAtColumn: "logged_at",
        summaryColumns: ["date", "prayer_name", "status"],
        fullColumns: ["date", "prayer_name", "status", "logged_at", "user_id"],
        filterableColumns: ["date", "prayer_name", "status"],
        orderBy: [
          { column: "date", ascending: false },
          { column: "prayer_name", ascending: true },
        ],
      },
    },
  },
  self_mastery: {
    domain: "self_mastery",
    description: "Book ingestion and spaced-repetition study.",
    entities: {
      /**
       * REGISTERED, DELIBERATELY EMPTY — the concrete worked case from
       * TOOL-ARCHITECTURE.md §3: "the owner was explicit that the source
       * text itself stays off MCP, and the visibility registry is where
       * that's enforced, not left to a `detail` parameter the model could
       * otherwise turn up to 'full'." `source_chunks.text` is the actual
       * book content ingestion extracts; `.embedding` is its pgvector
       * representation. Neither may ever reach a model's context.
       *
       * An ALLOWLIST enforces this by construction: `summaryColumns` and
       * `fullColumns` are both `[]`, so `read`'s own `resolveColumns` (see
       * lib/mcp/tools/read.ts) has nothing to select beyond the id/
       * updated_at every entity forces — and a `fields` request for
       * `"text"` or `"embedding"` is rejected the same way a request for
       * `user_api_keys.encrypted_key` would be: a clear error naming what
       * IS available (nothing), never a silent 200 with the value in it.
       * This is the "registered as excluded, same mechanism as the two
       * RLS-deny-all operational tables, just decided by us instead of by
       * Postgres" case the memo names explicitly.
       *
       * This entity is listed in `list_capabilities` — existence is not
       * secret, content is. A caller that discovers `source_chunks` and
       * tries `read(detail:"full")` gets `{id, updated_at}` and nothing
       * else, which is itself the honest answer: "this exists, you cannot
       * read it."
       */
      source_chunks: {
        entity: "source_chunks",
        table: "source_chunks",
        description: "Raw ingested book text and its embedding — existence only; content is deliberately never exposed over MCP.",
        idColumn: "id",
        updatedAtColumn: null, // no created_at/updated_at on this table either (migration 063) — honestly null, not invented
        summaryColumns: [],
        fullColumns: [],
        filterableColumns: [],
        orderBy: [{ column: "id", ascending: true }],
      },
    },
  },
};

export function listDomains(): { domain: string; description: string }[] {
  return Object.values(REGISTRY).map((d) => ({ domain: d.domain, description: d.description }));
}

export function getDomain(domain: string): DomainDef | null {
  return REGISTRY[domain] ?? null;
}

export function getEntity(domain: string, entity: string): EntityDef | null {
  return REGISTRY[domain]?.entities[entity] ?? null;
}
