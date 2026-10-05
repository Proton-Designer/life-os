import { describe, expect, it, vi } from "vitest";
import { hijriOf, ramadanWindow } from "../ramadan";

vi.mock("server-only", () => ({}));
import { startQuranPlanCore } from "../plan-core";
import { U, fakeSupabase } from "./fake-supabase";

// Expected values are what the engine's Umm al-Qura calendar ACTUALLY returns (checked, not assumed):
// 1 Ramadan 1447 = 2026-02-18 (30 days, last day 2026-03-19); 1 Ramadan 1448 = 2027-02-08 (29 days, last day 2027-03-08).
describe("hijriOf (Intl islamic-umalqura)", () => {
  it("converts known civil dates", () => {
    expect(hijriOf("2026-02-17")).toEqual({ year: 1447, month: 8, day: 29 });
    expect(hijriOf("2026-02-18")).toEqual({ year: 1447, month: 9, day: 1 });
    expect(hijriOf("2026-03-19")).toEqual({ year: 1447, month: 9, day: 30 });
    expect(hijriOf("2026-03-20")).toEqual({ year: 1447, month: 10, day: 1 });
    expect(hijriOf("2027-02-08")).toEqual({ year: 1448, month: 9, day: 1 });
  });
});

describe("ramadanWindow", () => {
  it("offered through Sha'ban and Ramadan, with the last day of Ramadan as the end (1447)", () => {
    for (const d of ["2026-01-20", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-19"]) {
      expect(ramadanWindow(d)).toEqual({ offer: true, ramadanEnd: "2026-03-19" });
    }
  });
  it("the day Shawwal begins (and after) is no longer offered", () => {
    expect(ramadanWindow("2026-03-20")).toEqual({ offer: false, ramadanEnd: null });
    expect(ramadanWindow("2026-06-01")).toEqual({ offer: false, ramadanEnd: null });
  });
  it("Ramadan 1448 (2027): 29 days, ends 2027-03-08; Sha'ban from ~2027-01-09 offers it", () => {
    expect(ramadanWindow("2027-01-10")).toEqual({ offer: true, ramadanEnd: "2027-03-08" });
    expect(ramadanWindow("2027-02-07")).toEqual({ offer: true, ramadanEnd: "2027-03-08" });
    expect(ramadanWindow("2027-02-08")).toEqual({ offer: true, ramadanEnd: "2027-03-08" });
    expect(ramadanWindow("2027-03-08")).toEqual({ offer: true, ramadanEnd: "2027-03-08" });
    expect(ramadanWindow("2027-03-09")).toEqual({ offer: false, ramadanEnd: null });
  });
  it("positive control: an ordinary month (Rabi' al-thani 1448, today) is not offered", () => {
    expect(hijriOf("2026-10-04")).toMatchObject({ year: 1448, month: 4 });
    expect(ramadanWindow("2026-10-04")).toEqual({ offer: false, ramadanEnd: null });
  });
});

describe("the Ramadan plan preset uses the server-known end date", () => {
  it("started inside Ramadan 1448 it finishes on the last day of Ramadan", async () => {
    const f = fakeSupabase();
    await startQuranPlanCore(f.client, U, "2027-02-08", { preset: { kind: "ramadan" } });
    expect(f.tables.quran_plans[0].target_date).toBe("2027-03-08");
    expect(Number(f.tables.quran_plans[0].original_pace_pages_per_day)).toBeCloseTo(604 / 29, 1); // 29-day Ramadan
  });
  it("outside the window it falls back to 30 days", async () => {
    const f = fakeSupabase();
    await startQuranPlanCore(f.client, U, "2026-10-04", { preset: { kind: "ramadan" } });
    expect(f.tables.quran_plans[0].target_date).toBe("2026-11-02");
  });
  it("a caller-supplied end date still wins", async () => {
    const f = fakeSupabase();
    await startQuranPlanCore(f.client, U, "2027-02-08", { preset: { kind: "ramadan", ramadanEnd: "2027-03-10" } });
    expect(f.tables.quran_plans[0].target_date).toBe("2027-03-10");
  });
});
