import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Target } from "lucide-react";
import { StatTile } from "../stat-tile";

describe("StatTile", () => {
  it("renders icon, label, and value", () => {
    render(<StatTile icon={Target} accent="business" label="Streak" value="6 days" />);
    expect(screen.getByText("Streak")).toBeInTheDocument();
    expect(screen.getByText("6 days")).toBeInTheDocument();
  });

  it("renders an optional delta pill", () => {
    render(<StatTile icon={Target} accent="business" label="Streak" value="6 days" delta={{ direction: "up", text: "+2" }} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("is compact — rounded-xl, not the Tier 1 rounded-2xl, and not accent-tinted background", () => {
    render(<StatTile icon={Target} accent="business" label="Streak" value="6 days" />);
    const tile = screen.getByTestId("stat-tile");
    expect(tile.className).toContain("rounded-xl");
    expect(tile.style.background).toBe("");
  });
});
