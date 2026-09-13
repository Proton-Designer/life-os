import type { UsageLogEntry, UsageStore } from "../usage-log";

/**
 * In-memory UsageStore for tests. No network, no Supabase, no service-role
 * key required — this is what makes the gateway's cap/retry/cost-accounting
 * logic testable with zero DB dependency, the same way `vi.stubGlobal("fetch", ...)`
 * makes the provider mockable with zero network dependency.
 */
export class FakeUsageStore implements UsageStore {
  entries: UsageLogEntry[] = [];

  async record(entry: UsageLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async totalServerKeySpendUsd(): Promise<number> {
    return this.entries.filter((e) => e.keySource === "server").reduce((sum, e) => sum + e.costUsd, 0);
  }
}
