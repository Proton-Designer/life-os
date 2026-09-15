import { vi } from "vitest";

/**
 * P4-17/P4-14 test doubles shared by route.test.ts and contract.test.ts (not
 * a test file itself: vitest only collects *.test.ts).
 *
 * - fakeServiceClient: mcp_audit_log inserts are recorded. The rate limit is
 *   now one atomic RPC (public.mcp_rate_limit_consume, migration 220) rather
 *   than a count query, so the fake keeps its own in-memory `hits` map keyed
 *   by bucket key ("tok:<id>" / "user:<id>" / their "sched-" siblings,
 *   exactly rateLimitBuckets()'s own keys) and mirrors the real RPC's
 *   contract: check every key against its limit, deny (consuming nothing) if
 *   any is at its limit, else increment all of them. `preloadCounts` seeds
 *   `tok:<id>` with prior hits, same convention the old count-based fake used.
 *   The budget is shared across whichever transport called it, which is
 *   exactly what the shared-rate-limit test needs to observe.
 * - fakeUserClient: one permissive, deterministic PostgREST chain. Any
 *   builder method returns the chain; awaiting it resolves to the table's
 *   rows. `range` slices, `single`/`maybeSingle` return the first row (or the
 *   profile). Both transports run the same handlers against it, so any shape
 *   a handler asks for produces the same answer for MCP and REST.
 */

export interface AuditRow extends Record<string, unknown> {
  token_id: string;
  transport?: string;
  outcome?: string;
  operation?: string;
}

export function fakeServiceClient(opts: { preloadCounts?: Record<string, number>; auditInsertError?: boolean; uncountedTokens?: string[] } = {}) {
  const auditInserts: AuditRow[] = [];
  const hits: Record<string, number> = {};
  for (const [tokenId, n] of Object.entries(opts.preloadCounts ?? {})) hits[`tok:${tokenId}`] = n;

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "update", "is", "order"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null, count: 0 });
    chain.insert = vi.fn((row: AuditRow) => {
      if (!opts.auditInsertError) auditInserts.push(row);
      return { then: (resolve: (v: unknown) => void) => resolve({ error: opts.auditInsertError ? { message: "boom" } : null }) };
    });
    return chain;
  });

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "mcp_rate_limit_consume") {
      const keys = args.p_keys as string[];
      const limits = args.p_limits as number[];
      // "tok:<id>" / "sched-tok:<id>" -> "<id>" (uncountedTokens is keyed by token id, not by bucket key).
      const tokenId = keys[0]?.split(":").slice(1).join(":");
      if (tokenId !== undefined && opts.uncountedTokens?.includes(tokenId)) return { data: { allowed: true }, error: null };
      for (let i = 0; i < keys.length; i++) {
        if ((hits[keys[i]] ?? 0) >= limits[i]) return { data: { allowed: false, limited_key: keys[i], retry_after_seconds: 60 }, error: null };
      }
      for (const key of keys) hits[key] = (hits[key] ?? 0) + 1;
      return { data: { allowed: true }, error: null };
    }
    if (name === "mcp_rate_limit_note_failure") return { data: { over_limit: false, retry_after_seconds: 60 }, error: null };
    return { data: null, error: null };
  });

  return { client: { from, rpc }, auditInserts };
}

export const TOKEN_ROW = {
  id: "tok-1",
  user_id: "user-1",
  token_hash: "h",
  token_last4: "abcd",
  label: "Instinct",
  scopes: ["read", "write"],
  created_at: "2026-09-01T00:00:00.000Z",
  last_used_at: null,
  revoked_at: null,
  expires_at: "2026-12-01T00:00:00.000Z",
  client_kind: "agent",
};

export function genericRow(i: number): Record<string, unknown> {
  return {
    id: `row-${i}`,
    user_id: "user-1",
    date: "2026-09-08",
    created_at: "2026-09-08T11:00:00.000Z",
    updated_at: "2026-09-08T11:00:00.000Z",
    logged_at: "2026-09-08T11:00:00.000Z",
    prayer_name: "fajr",
    status: "active",
    title: `Row ${i}`,
    name: `Row ${i}`,
    kind: "list",
    domain: "school",
    event_id: "evt-1",
    position: i,
    slot: "main",
    data_source: { domain: "deen", entity: "prayer" },
    display: {},
    timezone: "America/Chicago",
  };
}

export function fakeUserClient(opts: { rowCount?: number; tokens?: Record<string, unknown>[] } = {}) {
  const rows = Array.from({ length: opts.rowCount ?? 2 }, (_, i) => genericRow(i + 1));
  const rowsFor = (table: string) => (table === "mcp_access_tokens" ? (opts.tokens ?? [TOKEN_ROW]) : table === "user_domains" || table === "user_subdomains" ? [] : rows);

  function chainFor(table: string) {
    let slice: [number, number] | null = null;
    const result = () => {
      const all = rowsFor(table);
      return { data: slice ? all.slice(slice[0], slice[1] + 1) : all, error: null, count: all.length };
    };
    const one = () => ({ data: table === "profiles" ? { timezone: "America/Chicago", onboarding_completed: true } : (rowsFor(table)[0] ?? null), error: null });
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result());
        if (prop === "range") {
          return (a: number, b: number) => {
            slice = [a, b];
            return proxy;
          };
        }
        if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve(one());
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  }

  return { from: vi.fn((table: string) => chainFor(table)), rpc: vi.fn(async () => ({ data: null, error: null })) };
}
