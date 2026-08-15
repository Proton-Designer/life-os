import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaPill } from "../delta-pill";

describe("DeltaPill", () => {
  it("renders the text", () => {
    render(<DeltaPill direction="up" text="+12 pages" />);
    expect(screen.getByText("+12 pages")).toBeInTheDocument();
  });

  it("tints up as positive (business accent)", () => {
    render(<DeltaPill direction="up" text="+12 pages" />);
    expect(screen.getByText("+12 pages").closest("span")?.className).toContain("accent-business");
  });

  it("tints down as negative (destructive)", () => {
    render(<DeltaPill direction="down" text="-4 pages" />);
    expect(screen.getByText("-4 pages").closest("span")?.className).toContain("destructive");
  });

  it("tints flat as neutral", () => {
    render(<DeltaPill direction="flat" text="No change" />);
    expect(screen.getByText("No change").closest("span")?.className).toContain("muted");
  });

  it("renders a directional arrow icon for up/down but not flat", () => {
    const { rerender } = render(<DeltaPill direction="up" text="+1" />);
    expect(document.querySelector("svg")).toBeInTheDocument();

    rerender(<DeltaPill direction="flat" text="0" />);
    expect(document.querySelector("svg")).not.toBeInTheDocument();
  });
});
