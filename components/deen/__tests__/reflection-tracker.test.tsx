import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReflectionTracker } from "../reflection-tracker";

describe("ReflectionTracker", () => {
  it("renders each tier's today count in the mono numeral scale", () => {
    render(
      <ReflectionTracker
        entries={[
          { date: "2026-08-15", tier: 1 },
          { date: "2026-08-15", tier: 1 },
        ]}
        todayStr="2026-08-15"
      />
    );
    const counts = screen.getAllByText(/^[0-9]+$/);
    expect(counts.length).toBe(3);
    for (const count of counts) {
      expect(count.className).toContain("font-mono");
    }
  });

  it("adds no icon to the tally boxes themselves — glyph and count only, still no sin/severity language", () => {
    render(<ReflectionTracker entries={[]} todayStr="2026-08-15" />);
    for (const tier of [1, 2, 3]) {
      const tallyButton = screen.getByRole("button", { name: `Log entry, tier ${tier}` });
      expect(tallyButton.querySelector("svg")).not.toBeInTheDocument();
    }
  });

  it("upgrades the trend to the shared Sparkline primitive — one per tier, three total", () => {
    const { container } = render(<ReflectionTracker entries={[]} todayStr="2026-08-15" />);
    expect(container.querySelectorAll('svg[role="img"]').length).toBe(3);
  });

  it("never mentions sin or severity anywhere in visible text or aria-labels — privacy is a hard constraint", () => {
    const { container } = render(
      <ReflectionTracker entries={[{ date: "2026-08-15", tier: 3 }]} todayStr="2026-08-15" />
    );
    const text = container.textContent?.toLowerCase() ?? "";
    const ariaLabels = Array.from(container.querySelectorAll("[aria-label]")).map((el) =>
      (el.getAttribute("aria-label") ?? "").toLowerCase()
    );
    for (const banned of ["sin", "severity", "severe"]) {
      expect(text).not.toContain(banned);
      for (const label of ariaLabels) expect(label).not.toContain(banned);
    }
  });
});
