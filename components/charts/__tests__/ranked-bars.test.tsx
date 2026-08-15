import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankedBars } from "../ranked-bars";

describe("RankedBars", () => {
  it("renders every item, direct-labeled with its value", () => {
    render(
      <RankedBars
        items={[
          { label: "Business", value: 30, colorVar: "--series-business" },
          { label: "Deen", value: 42, colorVar: "--series-deen" },
        ]}
      />
    );
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows an empty state instead of crashing on zero items", () => {
    render(<RankedBars items={[]} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("does not crash with a single item", () => {
    render(<RankedBars items={[{ label: "Deen", value: 10, colorVar: "--series-deen" }]} />);
    expect(screen.getByText("Deen")).toBeInTheDocument();
  });
});
