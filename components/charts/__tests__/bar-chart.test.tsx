import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "../bar-chart";

describe("BarChart", () => {
  it("shows an empty state instead of crashing on zero bars", () => {
    render(<BarChart bars={[]} colorVar="--series-business" />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("does not crash on a single bar", () => {
    render(<BarChart bars={[{ label: "Week 1", value: 5 }]} colorVar="--series-business" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("does not crash when every value is zero", () => {
    render(
      <BarChart
        bars={[{ label: "W1", value: 0 }, { label: "W2", value: 0 }]}
        colorVar="--series-business"
      />
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("tints only the highlighted bar with --accent-info", () => {
    render(
      <BarChart
        bars={[{ label: "W1", value: 3 }, { label: "W2", value: 5 }]}
        colorVar="--series-business"
        highlightIndex={1}
      />
    );
    const highlighted = screen.getByRole("button", { name: "W2: 5" });
    const rest = screen.getByRole("button", { name: "W1: 3" });
    expect(highlighted.getAttribute("fill")).toBe("var(--accent-info)");
    expect(rest.getAttribute("fill")).toBe("var(--series-business)");
  });
});
