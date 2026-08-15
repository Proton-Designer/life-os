import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnRatioCard } from "../sn-ratio-card";

describe("SnRatioCard", () => {
  it("renders the ratio in the mono tabular-nums stat scale", () => {
    render(<SnRatioCard display="3:1" />);
    const value = screen.getByText("3:1");
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
  });

  it("renders a business-accent icon chip", () => {
    const { container } = render(<SnRatioCard display="3:1" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("still links to insights", () => {
    render(<SnRatioCard display="3:1" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/insights?domain=business");
  });
});
