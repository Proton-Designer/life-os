import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PulseStrip } from "../pulse-strip";

const PULSE = { deen: 0.4, business: 0.5, fitness: 0.6, school: 0.7, co_op: null };

describe("PulseStrip", () => {
  it("Deen Mode ON shows the Deen ring", () => {
    render(<PulseStrip pulse={PULSE} deenMode />);
    expect(screen.getByText("Deen")).toBeInTheDocument();
  });

  it("Deen Mode OFF drops the Deen ring (and its /deen link) but keeps the rest", () => {
    render(<PulseStrip pulse={PULSE} deenMode={false} />);
    expect(screen.queryByText("Deen")).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/deen"]')).toBeNull();
    for (const label of ["Business", "Fitness", "School"]) expect(screen.getByText(label)).toBeInTheDocument();
  });
});
