import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReflectionTimeOfDay } from "../reflection-time-of-day";

function entriesAt(isoUtc: string, count: number) {
  return Array.from({ length: count }, () => ({ createdAt: isoUtc }));
}

describe("ReflectionTimeOfDay", () => {
  it("honestly says there isn't enough data below 8 entries, rather than drawing noise", () => {
    render(<ReflectionTimeOfDay entries={entriesAt("2026-08-10T12:00:00Z", 5)} timezone="UTC" />);
    expect(screen.getByText(/not enough/i)).toBeInTheDocument();
  });

  it("shows the real distribution at 8 or more entries", () => {
    render(<ReflectionTimeOfDay entries={entriesAt("2026-08-10T12:00:00Z", 8)} timezone="UTC" />);
    expect(screen.queryByText(/not enough/i)).not.toBeInTheDocument();
    // All 8 fall in the same bucket here, so it appears twice — once as the
    // bar's own label, once in the cluster observation below it. Both are
    // correct; this just confirms the distribution rendered at all.
    expect(screen.getAllByText(/Afternoon/i).length).toBeGreaterThan(0);
  });

  it("surfaces an observation and a suggested action when entries clearly cluster", () => {
    // 04:00Z is 23:00 CDT (night bucket) — a clear majority.
    render(<ReflectionTimeOfDay entries={entriesAt("2026-08-10T04:00:00Z", 8)} timezone="America/Chicago" />);
    expect(screen.getByText(/clusters/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /habit/i })).toBeInTheDocument();
  });

  it("shows no cluster observation or suggestion when nothing clearly clusters", () => {
    const spread = [
      ...entriesAt("2026-08-10T02:00:00Z", 2), // night
      ...entriesAt("2026-08-10T08:00:00Z", 2), // morning
      ...entriesAt("2026-08-10T14:00:00Z", 2), // afternoon
      ...entriesAt("2026-08-10T20:00:00Z", 2), // evening
    ];
    render(<ReflectionTimeOfDay entries={spread} timezone="UTC" />);
    expect(screen.queryByText(/clusters/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /habit/i })).not.toBeInTheDocument();
  });

  it("frames the suggestion as an observation, never a verdict — no shame language", () => {
    render(<ReflectionTimeOfDay entries={entriesAt("2026-08-10T04:00:00Z", 8)} timezone="America/Chicago" />);
    expect(screen.queryByText(/fail|bad|wrong|shame/i)).not.toBeInTheDocument();
  });
});
