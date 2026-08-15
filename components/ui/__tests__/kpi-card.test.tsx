import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Target } from "lucide-react";
import { KpiCard } from "../kpi-card";

describe("KpiCard", () => {
  it("renders icon, label, hero value, and the mandatory caption", () => {
    render(
      <KpiCard
        icon={Target}
        accent="business"
        label="Kill list"
        value="1/3"
        caption="2 left, 4h of focus time remaining today"
      />
    );
    expect(screen.getByText("Kill list")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("2 left, 4h of focus time remaining today")).toBeInTheDocument();
  });

  it("renders a delta pill when given", () => {
    render(
      <KpiCard
        icon={Target}
        accent="deen"
        label="Qur'an this week"
        value="42 pages"
        caption="Best week in 3 — up 12 pages from last week"
        delta={{ direction: "up", text: "+12" }}
      />
    );
    expect(screen.getByText("+12")).toBeInTheDocument();
  });

  it("is always accent-tinted (Tier 1 is featured by definition, no plain mode)", () => {
    render(
      <KpiCard icon={Target} accent="fitness" label="Consistency" value="80%" caption="4/5 days this week" />
    );
    const card = screen.getByTestId("kpi-card");
    expect(card.style.backgroundImage).toContain("--accent-fitness");
  });

  it("has an opaque --card base, not just a transparent-past-70% radial wash", () => {
    render(<KpiCard icon={Target} accent="business" label="Kill list" value="1/3" caption="2 left" />);
    expect(screen.getByTestId("kpi-card").style.backgroundColor).toBe("var(--card)");
  });

  it("carries a fixed min-height so a row of them aligns exactly", () => {
    render(<KpiCard icon={Target} accent="school" label="Due today" value="0" caption="Nothing due yet" />);
    expect(screen.getByTestId("kpi-card").className).toContain("min-h-[168px]");
  });
});
