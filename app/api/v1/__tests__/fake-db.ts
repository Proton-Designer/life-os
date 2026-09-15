import { vi } from "vitest";

/**
 * P4-17 test doubles shared by route.test.ts and contract.test.ts (not a
 * test file itself: vitest only collects *.test.ts).
 *
 * - fakeServiceClient: mcp_audit_log inserts are recorded, and the rate-limit
 *   count query returns the number of recorded rows for the `token_id` it
 *   filters on (plus an optional per-token preload). The budget is therefore
 *   really shared across whichever transport wrote the rows, which is exactly
 *   what the shared-rate-limit test needs to observe.
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
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "gte", "update", "is", "order"]) chain[m] = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    });
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === "mcp_audit_log") {
        const tokenId = String(filters.token_id);
        // A token listed here always reads as "no recent calls": the contract test makes hundreds of calls and is not about the limit.
        if (opts.uncountedTokens?.includes(tokenId)) return resolve({ count: 0, error: null, data: null });
        const count = (opts.preloadCounts?.[tokenId] ?? 0) + auditInserts.filter((r) => r.token_id === tokenId).length;
        return resolve({ count, error: null, data: null });
      }
      return resolve({ data: null, error: null });
    };
    chain.insert = vi.fn((row: AuditRow) => {
      if (!opts.auditInsertError) auditInserts.push(row);
      return { then: (resolve: (v: unknown) => void) => resolve({ error: opts.auditInsertError ? { message: "boom" } : null }) };
    });
    return chain;
  });
  return { client: { from }, auditInserts };
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
