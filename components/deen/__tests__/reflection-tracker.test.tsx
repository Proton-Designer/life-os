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

  it("still shows no text label beyond the glyph and count — no icon added to the tally boxes", () => {
    const { container } = render(<ReflectionTracker entries={[]} todayStr="2026-08-15" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
