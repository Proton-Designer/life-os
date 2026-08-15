import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge variant="positive">Done</Badge>);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("defaults to the neutral variant", () => {
    render(<Badge>Plain</Badge>);
    expect(screen.getByText("Plain").className).toContain("text-muted-foreground");
  });

  it.each([
    ["positive", "text-accent-business"],
    ["negative", "text-destructive"],
    ["warning", "text-accent-deen"],
    ["info", "text-accent-info"],
    ["neutral", "text-muted-foreground"],
  ] as const)("applies the %s variant's color class", (variant, expectedClass) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText("x").className).toContain(expectedClass);
  });
});
