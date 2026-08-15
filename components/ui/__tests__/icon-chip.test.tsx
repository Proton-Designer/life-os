import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Moon } from "lucide-react";
import { IconChip } from "../icon-chip";

describe("IconChip", () => {
  it("renders the given icon", () => {
    render(<IconChip icon={Moon} accent="deen" data-testid="chip" />);
    expect(screen.getByTestId("chip").querySelector("svg")).toBeInTheDocument();
  });

  it("tints the chip background and icon color from the accent token", () => {
    render(<IconChip icon={Moon} accent="deen" data-testid="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.style.backgroundColor).toContain("--accent-deen");
    expect(chip.style.color).toContain("--accent-deen");
  });

  it("switches CSS variable when a different accent is given", () => {
    render(<IconChip icon={Moon} accent="info" data-testid="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.style.backgroundColor).toContain("--accent-info");
  });

  it("defaults to the md size class", () => {
    render(<IconChip icon={Moon} accent="deen" data-testid="chip" />);
    expect(screen.getByTestId("chip").className).toContain("size-9");
  });

  it("applies the sm size class when requested", () => {
    render(<IconChip icon={Moon} accent="deen" size="sm" data-testid="chip" />);
    expect(screen.getByTestId("chip").className).toContain("size-8");
  });
});
