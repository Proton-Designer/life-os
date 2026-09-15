import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeUserSettingsDb, type FakeUserSettingsDb } from "@/lib/settings/__tests__/fake-user-settings-db";

let db: FakeUserSettingsDb;

vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: vi.fn(async () => ({ id: "user-1", email: "t@example.test" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => db.client),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("saveWeekdayBaselines (UI action)", () => {
  beforeEach(() => {
    db = makeFakeUserSettingsDb();
  });

  // P4-23 positive control: the UI had the same bare-UPDATE silent no-op as
  // the MCP core — "Saved" shown, nothing stored, for an account with no row.
  it("P4-23: stores the values for an account with NO user_settings row", async () => {
    const { saveWeekdayBaselines } = await import("../weekday-baseline-actions");
    const res = await saveWeekdayBaselines([3, 3, 3, 3, 3, 2, 0]);
    expect(res).toEqual({ ok: true });
    expect(db.rows.get("user-1")?.weekday_baselines).toEqual([3, 3, 3, 3, 3, 2, 0]);
  });

  it("P4-23: returns an error, not ok, when the write matched 0 rows", async () => {
    db = makeFakeUserSettingsDb({ dropInserts: true });
    const { saveWeekdayBaselines } = await import("../weekday-baseline-actions");
    const res = await saveWeekdayBaselines([3, 3, 3, 3, 3, 2, 0]);
    expect(res).toMatchObject({ error: expect.stringMatching(/no user_settings row/i) });
  });

  it("keeps its own validation messages", async () => {
    const { saveWeekdayBaselines } = await import("../weekday-baseline-actions");
    expect(await saveWeekdayBaselines([1, 2])).toEqual({ error: "A week has seven days" });
    expect(await saveWeekdayBaselines([13, 0, 0, 0, 0, 0, 0])).toEqual({ error: "Each day must be a whole number of hours from 0 to 12" });
    expect(db.rows.size).toBe(0);
  });
});

describe("clearWeekdayBaselines (UI action)", () => {
  beforeEach(() => {
    db = makeFakeUserSettingsDb();
  });

  it("sets NULL on an existing row", async () => {
    db = makeFakeUserSettingsDb({ existingUserIds: ["user-1"] });
    db.rows.set("user-1", { ...db.rows.get("user-1"), weekday_baselines: [1, 1, 1, 1, 1, 1, 1] });
    const { clearWeekdayBaselines } = await import("../weekday-baseline-actions");
    expect(await clearWeekdayBaselines()).toEqual({ ok: true });
    expect(db.rows.get("user-1")?.weekday_baselines).toBeNull();
  });

  it("P4-23: returns an error, not ok, when the write matched 0 rows", async () => {
    db = makeFakeUserSettingsDb({ dropInserts: true });
    const { clearWeekdayBaselines } = await import("../weekday-baseline-actions");
    expect(await clearWeekdayBaselines()).toMatchObject({ error: expect.stringMatching(/no user_settings row/i) });
  });
});
