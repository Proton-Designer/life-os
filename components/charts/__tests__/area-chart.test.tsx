import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AreaChart } from "../area-chart";

describe("AreaChart", () => {
  it("renders a legend only for 2+ series, not for a single series", () => {
    const { rerender } = render(
      <AreaChart categories={["Mon", "Tue"]} series={[{ label: "Pages", colorVar: "--series-deen", values: [1, 2] }]} />
    );
    expect(screen.queryByText("Pages")).not.toBeInTheDocument();

    rerender(
      <AreaChart
        categories={["Mon", "Tue"]}
        series={[
          { label: "Pages", colorVar: "--series-deen", values: [1, 2] },
          { label: "Target", colorVar: "--accent-info", values: [3, 3] },
        ]}
      />
    );
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("shows an empty state instead of crashing on zero data points", () => {
    render(<AreaChart categories={[]} series={[]} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("renders a visible marker for a single data point — a lone path 'M' with no 'L' draws nothing", () => {
    const { container } = render(
      <AreaChart categories={["Mon"]} series={[{ label: "Pages", colorVar: "--series-deen", values: [5] }]} />
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(container.querySelector("circle")).toBeInTheDocument();
  });

  it("does not crash when every value is zero", () => {
    render(
      <AreaChart
        categories={["Mon", "Tue", "Wed"]}
        series={[{ label: "Pages", colorVar: "--series-deen", values: [0, 0, 0] }]}
      />
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
