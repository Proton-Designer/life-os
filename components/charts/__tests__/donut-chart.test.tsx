import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DonutChart } from "../donut-chart";

describe("DonutChart", () => {
  it("renders the center total and a legend entry per slice", () => {
    render(
      <DonutChart
        slices={[
          { label: "Signal", value: 3, colorVar: "--accent-business" },
          { label: "Noise", value: 1, colorVar: "--accent-noise" },
        ]}
        centerLabel="Signal:Noise"
        centerValue="3:1"
      />
    );
    expect(screen.getByText("3:1")).toBeInTheDocument();
    expect(screen.getByText("Signal")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("does not crash when every slice is zero", () => {
    render(
      <DonutChart
        slices={[
          { label: "Signal", value: 0, colorVar: "--accent-business" },
          { label: "Noise", value: 0, colorVar: "--accent-noise" },
        ]}
        centerLabel="Signal:Noise"
        centerValue="No data"
      />
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("does not crash with a single slice", () => {
    render(
      <DonutChart
        slices={[{ label: "Signal", value: 5, colorVar: "--accent-business" }]}
        centerLabel="Total"
        centerValue="5"
      />
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
