import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Moon } from "lucide-react";
import { StatCard } from "../stat-card";

describe("StatCard", () => {
  it("renders the label and value", () => {
    render(<StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" />);
    expect(screen.getByText("Prayers")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
  });

  it("renders the value in the mono, tabular-nums scale", () => {
    render(<StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" />);
    expect(screen.getByText("4/5").className).toContain("font-mono");
    expect(screen.getByText("4/5").className).toContain("tabular-nums");
  });

  it("renders an optional badge", () => {
    render(
      <StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" badge={<span>On track</span>} />
    );
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("does not apply a gradient wash by default", () => {
    render(<StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" data-testid="card" />);
    expect(screen.getByTestId("card").style.background).toBe("");
  });

  it("applies a gradient wash when featured", () => {
    render(
      <StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" featured data-testid="card" />
    );
    expect(screen.getByTestId("card").style.backgroundImage).toContain("--accent-deen");
  });

  it("has an opaque --card base when featured, not just a transparent-past-70% radial wash", () => {
    render(
      <StatCard icon={Moon} accent="deen" label="Prayers" value="4/5" featured data-testid="card" />
    );
    expect(screen.getByTestId("card").style.backgroundColor).toBe("var(--card)");
  });
});
