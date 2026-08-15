import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QadaCounter } from "../qada-counter";

describe("QadaCounter", () => {
  it("renders the owed count in the mono tabular-nums stat scale", () => {
    render(<QadaCounter owed={4} />);
    const value = screen.getByText("4");
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
  });

  it("renders a domain icon chip", () => {
    const { container } = render(<QadaCounter owed={0} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("still renders the increment/decrement controls", () => {
    render(<QadaCounter owed={2} />);
    expect(screen.getByLabelText("Increase qada owed")).toBeInTheDocument();
    expect(screen.getByLabelText("Decrease qada owed")).toBeInTheDocument();
  });
});
