import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "../sparkline";

describe("Sparkline", () => {
  it("renders without crashing for a normal series", () => {
    render(<Sparkline values={[1, 3, 2, 5, 4]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("does not crash for an empty series", () => {
    render(<Sparkline values={[]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a visible marker for a single point — a lone path 'M' with no 'L' draws nothing", () => {
    const { container } = render(<Sparkline values={[5]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(container.querySelector("circle")).toBeInTheDocument();
  });

  it("does not crash when every value is identical (zero variance)", () => {
    render(<Sparkline values={[3, 3, 3]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
