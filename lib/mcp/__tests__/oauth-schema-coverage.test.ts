import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerOAuthClient, mintAuthorizationCode, mintRefreshToken } from "../oauth";

/**
 * The regression test for the class of bug the Lead found, not just the one
 * instance of it: `mintAuthorizationCode` computed `expires_at` and never
 * passed it to the insert. `mcp_oauth_codes` declares that column
 * `not null` with no default (migration 132) — every single mint failed in
 * production, 100% reproducible — and NONE of this file's siblings caught
 * it, because they all mock the Supabase client. A mock accepts any
 * payload; it has no NOT NULL constraint to violate. Per the Lead: "a mock
 * asserting 'we passed 8 fields' is not it."
 *
 * So this file does not mock the schema away. It reads the REAL migration
 * text (supabase/migrations/132_mcp_oauth.sql — frozen, applied, not
 * something this test can accidentally describe wrong by drifting from a
 * hand-copied column list) and asserts that every insert this module
 * performs actually carries every column that migration declares `not
 * null` with no default. If a future column is added to one of these
 * tables as NOT NULL and the corresponding insert here isn't updated to
 * supply it, THIS test fails — not a live 23502 in production days later.
 *
 * Deliberately not a real-Postgres integration test (the alternative the
 * Lead named): there's no existing harness in this repo for spinning one up
 * inside vitest, and building one is a bigger project than this regression
 * warrants. This is the smaller of the two honest options, not a shortcut
 * dressed as the real thing — it reads the actual DDL, not a copy of it.
 */

const MIGRATION_PATH = path.resolve(__dirname, "../../../supabase/migrations/132_mcp_oauth.sql");

/**
 * Extracts the column names a `create table` statement in THIS file's
 * specific style declares `not null` with no `default` — i.e. columns an
 * INSERT must supply or Postgres will reject the row. Not a general SQL
 * parser: tracks paren+bracket depth to split column/constraint
 * definitions on top-level commas only (so a comma inside e.g.
 * `check (scopes <@ array['read','write']::text[] ...)` isn't mistaken for
 * a column separator), then reads each segment's leading identifier as the
 * column name. Good enough for a frozen, already-applied migration file
 * whose grammar isn't going to change out from under it.
 */
function requiredColumnsWithoutDefault(migrationSql: string, tableName: string): string[] {
  const tableRegex = new RegExp(`create table if not exists public\\.${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, "m");
  const match = migrationSql.match(tableRegex);
  if (!match) {
    throw new Error(`Could not find "create table if not exists public.${tableName}" in ${MIGRATION_PATH}`);
  }
  const body = match[1];

  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current);

  const required: string[] = [];
  for (const raw of segments) {
    const seg = raw.trim().replace(/\s+/g, " ");
    const nameMatch = seg.match(/^([a-z_][a-z0-9_]*)\s+/i);
    if (!nameMatch) continue; // a table-level constraint line, not a column
    const name = nameMatch[1];
    const hasNotNull = /\bnot null\b/i.test(seg);
    const isPrimaryKey = /\bprimary key\b/i.test(seg);
    const hasDefault = /\bdefault\b/i.test(seg);
    if ((hasNotNull || isPrimaryKey) && !hasDefault) required.push(name);
  }
  return required;
}

/** Records every payload passed to `.insert(...)`, regardless of what else the call chains. */
function makeCapturingClient(otherCallsResolveTo: Record<string, unknown> = { data: null, error: null, count: 0 }) {
  const inserted: Record<string, unknown>[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "is", "order"]) chain[method] = () => chain;
  chain.insert = (payload: Record<string, unknown>) => {
    inserted.push(payload);
    return chain;
  };
  chain.single = async () => otherCallsResolveTo;
  chain.maybeSingle = async () => otherCallsResolveTo;
  chain.then = (resolve: (v: Record<string, unknown>) => void) => resolve(otherCallsResolveTo);
  const client = { from: () => chain } as unknown as SupabaseClient;
  return { client, inserted };
}

const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

describe("schema coverage — every L4 insert supplies every NOT NULL column the real migration declares", () => {
  it("sanity: the parser actually finds columns for all three tables (a parser bug would make every check below vacuously pass)", () => {
    expect(requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_clients").length).toBeGreaterThan(0);
    expect(requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_codes").length).toBeGreaterThan(0);
    expect(requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_refresh_tokens").length).toBeGreaterThan(0);
  });

  it("sanity: mcp_oauth_codes' required columns include expires_at — proves this test would have caught the actual bug", () => {
    expect(requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_codes")).toContain("expires_at");
  });

  it("registerOAuthClient's insert into mcp_oauth_clients covers every required column", async () => {
    const required = requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_clients");
    const { client, inserted } = makeCapturingClient();
    await registerOAuthClient(client, { redirect_uris: ["https://a.example.com/cb"], client_name: "Test" });
    expect(inserted).toHaveLength(1);
    const missing = required.filter((col) => !(col in inserted[0]));
    expect(missing, `missing required column(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("mintAuthorizationCode's insert into mcp_oauth_codes covers every required column (THE regression case)", async () => {
    const required = requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_codes");
    const { client, inserted } = makeCapturingClient();
    await mintAuthorizationCode(client, {
      clientId: "lifeos_client_abc",
      userId: "user-1",
      redirectUri: "https://a.example.com/cb",
      codeChallenge: "a-challenge-value",
      codeChallengeMethod: "S256",
      scopes: ["read"],
    });
    expect(inserted).toHaveLength(1);
    const missing = required.filter((col) => !(col in inserted[0]));
    expect(missing, `missing required column(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("mintRefreshToken's insert into mcp_oauth_refresh_tokens covers every required column", async () => {
    const required = requiredColumnsWithoutDefault(migrationSql, "mcp_oauth_refresh_tokens");
    const { client, inserted } = makeCapturingClient();
    await mintRefreshToken(client, { accessTokenId: "tok-1", clientId: "lifeos_client_abc", userId: "user-1" });
    expect(inserted).toHaveLength(1);
    const missing = required.filter((col) => !(col in inserted[0]));
    expect(missing, `missing required column(s): ${missing.join(", ")}`).toEqual([]);
  });
});
