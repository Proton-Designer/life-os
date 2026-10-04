import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let optIn = true;
let starts = new Map<string, string>();
let closes = new Map<string, string>();
let plan: { bedtime: string } | null = { bedtime: "23:00" };
vi.mock("@/lib/opt-in-guard", () => ({ isOptInFeatureOnForRequest: async () => optIn }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthedUser: async () => ({ id: "u1" }), getProfile: async () => ({ timezone: "America/Chicago" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/day-structure/day-start", () => ({ getDayStartsForRange: async () => starts }));
vi.mock("@/lib/day-structure/closed-day", () => ({ getEveningClosesForRange: async () => closes }));
vi.mock("@/lib/rhythm/wind-down-core", () => ({ getWindDownSettingsCore: async () => ({ plan }) }));
vi.mock("@/components/ui/panel", () => ({ Panel: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section> }));

import { RhythmCard } from "../rhythm-card";

const iso = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, day, h! + 5, m!)).toISOString(); // Chicago CDT
};

describe("RhythmCard", () => {
  beforeEach(() => {
    optIn = true;
    plan = { bedtime: "23:00" };
    starts = new Map();
    closes = new Map();
  });

  it("renders nothing when the Sleep plan is OFF", async () => {
    optIn = false;
    expect(await RhythmCard()).toBeNull();
  });

  it("under 3 data points it says what it needs instead of a number", async () => {
    starts = new Map([["2026-10-01", iso(1, "07:00")]]);
    render(await RhythmCard());
    expect(screen.getByText(/Wake time: needs 3 mornings/)).toBeInTheDocument();
    expect(screen.getByText(/Close vs bedtime: needs 3 closed days/)).toBeInTheDocument();
  });

  it("with enough data shows the wake spread and close-vs-bedtime counts", async () => {
    starts = new Map([["2026-10-01", iso(1, "06:30")], ["2026-10-02", iso(2, "07:00")], ["2026-10-03", iso(3, "08:00")]]);
    closes = new Map([["2026-10-01", iso(1, "22:00")], ["2026-10-02", iso(2, "23:00")], ["2026-10-03", iso(4, "00:30")]]);
    render(await RhythmCard());
    expect(screen.getByText(/usually around 07:00, between 06:30 and 08:00 \(90 min spread over 3 mornings\)/)).toBeInTheDocument();
    expect(screen.getByText(/finished by bedtime on 2 of 3 nights/)).toBeInTheDocument();
  });

  it("without a wind-down plan it points to Settings rather than inventing a bedtime", async () => {
    plan = null;
    render(await RhythmCard());
    expect(screen.getByText(/set your wake time and sleep need in Settings/)).toBeInTheDocument();
  });
});
