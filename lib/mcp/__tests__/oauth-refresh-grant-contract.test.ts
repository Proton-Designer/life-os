import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { runRefreshGrant } from "../oauth";

/**
 * P4-13 RPC CONTRACT — a thin, honest test of the seam the fake-DB tests
 * cannot see. The route/runner tests run against a JS mirror of
 * public.mcp_oauth_refresh_grant; this file pins the JS caller to the REAL
 * function as written in migration 217 (applied, e102fba) and as generated
 * into database.types.ts, so a renamed parameter, a new outcome, or a loosened
 * grant fails here instead of in production.
 */

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/217_mcp_oauth_refresh_grant_and_client_prune.sql"),
  "utf8",
);

type GrantArgs = Database["public"]["Functions"]["mcp_oauth_refresh_grant"]["Args"];

function captureArgs() {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: { outcome: "invalid" }, error: null }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("mcp_oauth_refresh_grant contract (migration 217 <-> runRefreshGrant)", () => {
  it("runRefreshGrant sends exactly the SQL function's parameter names, and they type-check against the generated Args", async () => {
    const sigMatch = /create or replace function public\.mcp_oauth_refresh_grant\(([\s\S]*?)\)\s*returns jsonb/i.exec(MIGRATION);
    expect(sigMatch, "function signature not found in 217").not.toBeNull();
    const sqlParams = sigMatch![1]
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean)
      .sort();

    const { client, rpc } = captureArgs();
    await runRefreshGrant(client, "lifeos_oauthrefresh_x", { label: "OAuth: X", expiresAt: "2026-10-15T00:00:00.000Z" });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("mcp_oauth_refresh_grant");
    expect(Object.keys(args).sort()).toEqual(sqlParams);

    // Compile-time half: if the generated Args drift from what we send, tsc fails on this line.
    const typed: GrantArgs = args as GrantArgs;
    expect(Object.keys(typed).sort()).toEqual(sqlParams);
    for (const v of Object.values(args)) expect(typeof v).toBe("string");
  });

  it("every outcome the SQL can return is one runRefreshGrant handles, and nothing else", async () => {
    const sqlOutcomes = [...MIGRATION.matchAll(/'outcome',\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(sqlOutcomes)).toEqual(new Set(["invalid", "reuse", "revoked", "ok"]));

    for (const outcome of ["invalid", "reuse", "revoked"]) {
      const rpc = vi.fn(async () => ({ data: { outcome }, error: null }));
      expect((await runRefreshGrant({ rpc } as unknown as SupabaseClient, "rt", { label: "l", expiresAt: "x" })).outcome).toBe(outcome);
    }
  });

  it("the ok payload keys runRefreshGrant reads are the keys the SQL builds", () => {
    const okBlock = /'outcome', 'ok'[\s\S]*?\);/.exec(MIGRATION)![0];
    expect(okBlock).toContain("'access_token_id'");
    expect(okBlock).toContain("'scopes'");
  });

  it("the SQL error text runRefreshGrant maps to `cap` is the one the migration-215 trigger raises", () => {
    const m215 = fs.readFileSync(path.resolve(__dirname, "../../../supabase/migrations/215_mcp_token_lifecycle.sql"), "utf8");
    expect(m215).toContain("raise exception 'mcp_token_cap:");
  });

  it("the function stays service_role-only and SECURITY DEFINER with an empty search_path", () => {
    expect(MIGRATION).toMatch(/revoke all on function public\.mcp_oauth_refresh_grant\([^)]*\) from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.mcp_oauth_refresh_grant\([^)]*\) to service_role;/);
    const body = /create or replace function public\.mcp_oauth_refresh_grant[\s\S]*?as \$\$/.exec(MIGRATION)![0];
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
    expect(MIGRATION).toMatch(/pg_advisory_xact_lock/);
  });
});
