import { describe, expect, it, vi } from "vitest";
import type { PrayerWindow } from "@/lib/prayer-times/windows";

vi.mock("@/lib/prayer-times/windows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/prayer-times/windows")>();
  return { ...actual, computePrayerWindows: vi.fn(actual.computePrayerWindows) };
});

import { computePrayerWindows } from "@/lib/prayer-times/windows";
import { effectivePrayerStatus, resolvePrayerStatuses, computeTrackingFloorDateStr } from "../prayer-status";

const WINDOW: PrayerWindow = {
  start: new Date("2026-08-10T10:00:00Z"),
  end: new Date("2026-08-10T13:00:00Z"),
};

describe("effectivePrayerStatus", () => {
  it("a stored status always wins, even if the window has closed", () => {
    expect(effectivePrayerStatus("on_time", WINDOW, new Date("2026-08-10T14:00:00Z"))).toBe("on_time");
    expect(effectivePrayerStatus("qada", WINDOW, new Date("2026-08-10T14:00:00Z"))).toBe("qada");
  });

  it("a stored status always wins, even if the window hasn't opened yet", () => {
    expect(effectivePrayerStatus("missed", WINDOW, new Date("2026-08-10T09:00:00Z"))).toBe("missed");
  });

  it("a null window is never derived as missed — always pending", () => {
    expect(effectivePrayerStatus(null, null, new Date("2026-08-10T23:59:00Z"))).toBe("pending");
    expect(effectivePrayerStatus(null, null, new Date("2000-01-01T00:00:00Z"))).toBe("pending");
  });

  it("derives upcoming when now is before the window opens", () => {
    expect(effectivePrayerStatus(null, WINDOW, new Date("2026-08-10T09:59:59Z"))).toBe("upcoming");
  });

  it("derives pending at the window's start boundary and while inside it", () => {
    expect(effectivePrayerStatus(null, WINDOW, WINDOW.start)).toBe("pending");
    expect(effectivePrayerStatus(null, WINDOW, new Date("2026-08-10T11:30:00Z"))).toBe("pending");
  });

  it("derives missed at the window's end boundary and after it", () => {
    expect(effectivePrayerStatus(null, WINDOW, WINDOW.end)).toBe("missed");
    expect(effectivePrayerStatus(null, WINDOW, new Date("2026-08-10T23:00:00Z"))).toBe("missed");
  });
});

const CHICAGO = {
  lat: 41.8781,
  lng: -87.6298,
  timezone: "America/Chicago",
  calcMethod: "MWL" as const,
  asrMadhab: "standard" as const,
};

describe("resolvePrayerStatuses", () => {
  it("resolves a stored row as itself, unaffected by the window", () => {
    const result = resolvePrayerStatuses({
      rows: [{ date: "2026-08-10", prayer_name: "fajr", status: "on_time" }],
      dates: ["2026-08-10"],
      now: new Date("2026-08-10T18:00:00Z"),
      accountCreatedDateStr: "2020-01-01",
      ...CHICAGO,
    });

    expect(result["2026-08-10"].fajr).toBe("on_time");
  });

  it("derives missed for an unlogged prayer whose window has clearly closed", () => {
    const result = resolvePrayerStatuses({
      rows: [],
      dates: ["2026-08-05"],
      now: new Date("2026-08-10T18:00:00Z"),
      accountCreatedDateStr: "2020-01-01",
      ...CHICAGO,
    });

    for (const status of Object.values(result["2026-08-05"])) {
      expect(status).toBe("missed");
    }
  });

  it("never derives missed for a date before the account's floor, even with no rows and a would-be-closed window", () => {
    const result = resolvePrayerStatuses({
      rows: [],
      dates: ["2020-01-01"],
      now: new Date("2026-08-10T18:00:00Z"),
      accountCreatedDateStr: "2026-01-01",
      ...CHICAGO,
    });

    for (const status of Object.values(result["2020-01-01"])) {
      expect(status).toBe("pending");
    }
  });

  it("still honors a stored row before the account's floor rather than overriding it", () => {
    const result = resolvePrayerStatuses({
      rows: [{ date: "2020-01-01", prayer_name: "fajr", status: "qada" }],
      dates: ["2020-01-01"],
      now: new Date("2026-08-10T18:00:00Z"),
      accountCreatedDateStr: "2026-01-01",
      ...CHICAGO,
    });

    expect(result["2020-01-01"].fajr).toBe("qada");
  });

  it("never derives missed when no location is set, regardless of date", () => {
    const result = resolvePrayerStatuses({
      rows: [],
      dates: ["2026-08-05"],
      now: new Date("2026-08-10T18:00:00Z"),
      accountCreatedDateStr: "2020-01-01",
      lat: null,
      lng: null,
      timezone: CHICAGO.timezone,
      calcMethod: CHICAGO.calcMethod,
      asrMadhab: CHICAGO.asrMadhab,
    });

    for (const status of Object.values(result["2026-08-05"])) {
      expect(status).toBe("pending");
    }
  });

  it("mixes upcoming/pending/missed correctly across today's prayers, right now", () => {
    // 2026-08-10 in Chicago: pick a `now` mid-afternoon so Fajr/Dhuhr have
    // closed, Asr is likely open or closed depending on time of year, and
    // Isha hasn't opened yet. Assert only the unambiguous ends.
    const now = new Date("2026-08-10T15:00:00Z"); // 10am CDT
    const result = resolvePrayerStatuses({
      rows: [],
      dates: ["2026-08-10"],
      now,
      accountCreatedDateStr: "2020-01-01",
      ...CHICAGO,
    });

    expect(result["2026-08-10"].fajr).toBe("missed");
    expect(result["2026-08-10"].isha).toBe("upcoming");
  });

  describe("date-window skip optimization", () => {
    // Isha's window extends to the *next* day's Fajr (its outer bound), so
    // any date <= T-2 is structurally closed no matter what real windows
    // would say — no astronomy needed. Only T-1 and T can still have an
    // open window relative to `now`. Pinned here because an off-by-one
    // would silently mark a still-valid Isha as missed — exactly the
    // failure class the whole windows design exists to prevent.
    const T = "2026-08-15";
    const T_MINUS_1 = "2026-08-14";
    const T_MINUS_2 = "2026-08-13";
    // 3am CDT on T — well before Fajr on T (~5:15am in August), so
    // T-1's Isha window (open until T's Fajr) is still genuinely open.
    const NOW = new Date("2026-08-15T08:00:00Z");

    it("still resolves T-1 with real windows — a still-open Isha reads as pending, not missed", () => {
      const result = resolvePrayerStatuses({
        rows: [],
        dates: [T_MINUS_1],
        now: NOW,
        accountCreatedDateStr: "2020-01-01",
        ...CHICAGO,
      });
      expect(result[T_MINUS_1].isha).toBe("pending");
    });

    it("resolves T-2 as closed (missed when unlogged) without needing a real window", () => {
      const result = resolvePrayerStatuses({
        rows: [],
        dates: [T_MINUS_2],
        now: NOW,
        accountCreatedDateStr: "2020-01-01",
        ...CHICAGO,
      });
      for (const status of Object.values(result[T_MINUS_2])) {
        expect(status).toBe("missed");
      }
    });

    it("still honors a stored row on an old (fast-pathed) date rather than overriding it", () => {
      const result = resolvePrayerStatuses({
        rows: [{ date: T_MINUS_2, prayer_name: "fajr", status: "qada" }],
        dates: [T_MINUS_2],
        now: NOW,
        accountCreatedDateStr: "2020-01-01",
        ...CHICAGO,
      });
      expect(result[T_MINUS_2].fajr).toBe("qada");
    });

    it("still respects the account-creation floor on an old (fast-pathed) date", () => {
      const result = resolvePrayerStatuses({
        rows: [],
        dates: [T_MINUS_2],
        now: NOW,
        accountCreatedDateStr: T, // account created today — T-2 predates it
        ...CHICAGO,
      });
      for (const status of Object.values(result[T_MINUS_2])) {
        expect(status).toBe("pending");
      }
    });

    it("calls computePrayerWindows only for T and T-1, not for older dates in a 60-day range", () => {
      vi.mocked(computePrayerWindows).mockClear();
      const sixtyDates = Array.from({ length: 60 }, (_, i) => {
        const d = new Date(`${T}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - (59 - i));
        return d.toISOString().slice(0, 10);
      });
      resolvePrayerStatuses({
        rows: [],
        dates: sixtyDates,
        now: NOW,
        accountCreatedDateStr: "2020-01-01",
        ...CHICAGO,
      });
      expect(computePrayerWindows).toHaveBeenCalledTimes(2);
    });
  });
});

// 2026-08-26, Opus Lead ruling correcting R7: profiles.created_at is the
// wrong floor for "don't derive missed" once prayer history has been
// wiped without moving it — tracking_started_on exists specifically to
// let a fresh-start account re-floor without touching created_at.
describe("computeTrackingFloorDateStr", () => {
  it("uses tracking_started_on as-is when set, ignoring created_at entirely", () => {
    const profile = { tracking_started_on: "2026-08-26", created_at: "2020-01-01T00:00:00Z" };
    expect(computeTrackingFloorDateStr(profile, "America/Chicago", new Date("2026-08-26T12:00:00Z"))).toBe(
      "2026-08-26"
    );
  });

  it("falls back to created_at's local date when tracking_started_on is null", () => {
    const profile = { tracking_started_on: null, created_at: "2026-08-10T00:00:00Z" };
    expect(computeTrackingFloorDateStr(profile, "America/Chicago", new Date("2026-08-26T12:00:00Z"))).toBe(
      "2026-08-09" // UTC midnight Aug 10 is 2026-08-09 19:00 in Chicago (UTC-5)
    );
  });

  it("falls back to now's local date when profile itself is null", () => {
    expect(computeTrackingFloorDateStr(null, "America/Chicago", new Date("2026-08-26T12:00:00Z"))).toBe("2026-08-26");
  });

  // The inverse-bug boundary (AGENTS.md): tracking_started_on is a plain
  // calendar date, not an instant. Naively doing
  // `localDateString(new Date(trackingStartedOn), timezone)` would parse it
  // as UTC midnight and re-localize it a day BACKWARD in any timezone
  // behind UTC. Pinned on both sides: a zone behind UTC (Chicago) and one
  // east of UTC (Karachi), where the naive bug would instead push the date
  // FORWARD were the mistake made in the other direction.
  it("never shifts tracking_started_on by a day in a timezone behind UTC (Chicago, UTC-5)", () => {
    const profile = { tracking_started_on: "2026-08-26", created_at: "2020-01-01T00:00:00Z" };
    expect(computeTrackingFloorDateStr(profile, "America/Chicago", new Date("2026-08-26T02:00:00Z"))).toBe(
      "2026-08-26"
    );
  });

  it("never shifts tracking_started_on by a day in a timezone east of UTC (Karachi, UTC+5)", () => {
    const profile = { tracking_started_on: "2026-08-26", created_at: "2020-01-01T00:00:00Z" };
    expect(computeTrackingFloorDateStr(profile, "Asia/Karachi", new Date("2026-08-26T22:00:00Z"))).toBe("2026-08-26");
  });
});
