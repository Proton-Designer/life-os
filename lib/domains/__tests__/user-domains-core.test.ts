import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/** P4-03 — the cookie-free half of getUserDomains, callable with any client + userId (MCP bearer path). Red first. */

function makeClient(tables: Record<string, { data: unknown }>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return chain;
      });
    }
    const resolved = { data: tables[table]?.data ?? null, error: null };
    chain.maybeSingle = vi.fn(async () => resolved);
    chain.then = (resolve: (v: unknown) => void) => resolve(resolved);
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("getUserDomainsForUser", () => {
  it("legacy: onboarding completed and zero active domains", async () => {
    const { getUserDomainsForUser } = await import("../user-domains-core");
    const { client } = makeClient({ user_domains: { data: [] } });
    await expect(getUserDomainsForUser(client, "user-1", { onboardingCompleted: true })).resolves.toEqual({ mode: "legacy" });
  });

  it("mid-onboarding (not completed, zero domains) is domains mode with nothing selected, not legacy", async () => {
    const { getUserDomainsForUser } = await import("../user-domains-core");
    const { client } = makeClient({ user_domains: { data: [] } });
    await expect(getUserDomainsForUser(client, "user-1", { onboardingCompleted: false })).resolves.toEqual({ mode: "domains", domains: [], subdomains: [] });
  });

  it("reads onboarding_completed from the profile itself when the caller doesn't pass it", async () => {
    const { getUserDomainsForUser } = await import("../user-domains-core");
    const { client } = makeClient({ profiles: { data: { onboarding_completed: true } }, user_domains: { data: [] } });
    await expect(getUserDomainsForUser(client, "user-1")).resolves.toEqual({ mode: "legacy" });
  });

  it("domains mode maps subdomains to their parent key, scoped to the given user", async () => {
    const { getUserDomainsForUser } = await import("../user-domains-core");
    const { client, calls } = makeClient({
      user_domains: { data: [{ id: "d1", key: "work", position: 0, weight: "essential" }] },
      user_subdomains: { data: [{ domain_id: "d1", key: "acme", label: "Acme", kind: "job", widgets: null, config: null, position: 0 }] },
    });
    const state = await getUserDomainsForUser(client, "user-9", { onboardingCompleted: true });
    expect(state).toEqual({
      mode: "domains",
      domains: [{ key: "work", position: 0, weight: "essential" }],
      subdomains: [{ domainKey: "work", key: "acme", label: "Acme", kind: "job", widgets: [], config: {}, position: 0 }],
    });
    expect(calls.filter((c) => c.method === "eq" && c.args[0] === "user_id").every((c) => c.args[1] === "user-9")).toBe(true);
  });
});
