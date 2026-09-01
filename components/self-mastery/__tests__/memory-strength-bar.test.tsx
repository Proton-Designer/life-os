import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryStrengthBar } from "../memory-strength-bar";

describe("MemoryStrengthBar", () => {
  // No fabricated data (ULM lead, twice): a book/lesson nobody has
  // reviewed renders at a real, honest 0% — never padded up, never hidden.
  it("renders 0% for a value of 0, not omitted", () => {
    render(<MemoryStrengthBar value={0} label="Overall" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders the reviewed/total caption honestly when provided", () => {
    render(<MemoryStrengthBar value={0} reviewedCount={0} totalCount={5} />);
    expect(screen.getByText("0 of 5 cards reviewed")).toBeInTheDocument();
  });

  it("rounds and clamps into a 0-100% range", () => {
    render(<MemoryStrengthBar value={1.4} label="X" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
