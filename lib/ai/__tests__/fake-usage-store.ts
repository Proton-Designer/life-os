import type { UsageLogEntry, UsageStore } from "../usage-log";

/**
 * In-memory UsageStore for tests. No network, no Supabase, no service-role
 * key required — this is what makes the gateway's cap/retry/cost-accounting
 * logic testable with zero DB dependency, the same way `vi.stubGlobal("fetch", ...)`
 * makes the provider mockable with zero network dependency.
 */
interface FakeEntry extends UsageLogEntry {
  /** When this row was "recorded" — real `record()` calls stamp `new Date()`; `seed()` lets a monthly-cap test place a row at an exact past/future instant without a fake clock. */
  recordedAt: Date;
}

export class FakeUsageStore implements UsageStore {
  entries: FakeEntry[] = [];

  async record(entry: UsageLogEntry): Promise<void> {
    this.entries.push({ ...entry, recordedAt: new Date() });
  }

  /** Test-only seam: push an entry stamped at a specific instant, for monthly-window tests (see lib/ai/__tests__/monthly-spend-cap.test.ts and gateway.test.ts's monthly-cap describe block). */
  seed(entry: UsageLogEntry, recordedAt: Date): void {
    this.entries.push({ ...entry, recordedAt });
  }

  async totalServerKeySpendUsd(): Promise<number> {
    return this.entries.filter((e) => e.keySource === "server").reduce((sum, e) => sum + e.costUsd, 0);
  }

  async monthlySpendUsdForUser(userId: string, startUtc: Date, endUtc: Date): Promise<number> {
    return this.entries
      .filter((e) => e.userId === userId && e.recordedAt >= startUtc && e.recordedAt < endUtc)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }
}
