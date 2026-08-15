import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel } from "../panel";

describe("Panel", () => {
  it("renders a title and children", () => {
    render(
      <Panel title="Kill list">
        <p>Body content</p>
      </Panel>
    );
    expect(screen.getByText("Kill list")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("carries data-panel for the overflow-check selector Phase C will add", () => {
    render(
      <Panel title="Kill list" data-testid="panel">
        <p>Body</p>
      </Panel>
    );
    expect(screen.getByTestId("panel")).toHaveAttribute("data-panel");
  });

  it("renders controls in the header when given", () => {
    render(
      <Panel title="Focus Map" controls={<button type="button">Day</button>}>
        <p>Body</p>
      </Panel>
    );
    expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument();
  });

  it("renders a hero value + delta + caption when the one-metric rule applies", () => {
    render(
      <Panel
        title="Signal:Noise by week"
        heroValue="4.2:1"
        delta={{ direction: "up", text: "+0.6 vs last week" }}
        caption="Best week in 3 — up 12 pages from last week"
      >
        <p>Chart</p>
      </Panel>
    );
    expect(screen.getByText("4.2:1")).toBeInTheDocument();
    expect(screen.getByText("+0.6 vs last week")).toBeInTheDocument();
    expect(screen.getByText("Best week in 3 — up 12 pages from last week")).toBeInTheDocument();
  });

  it("renders no hero row at all when heroValue is omitted — a plain panel isn't forced into KPI shape", () => {
    render(
      <Panel title="Kill list">
        <p>Body</p>
      </Panel>
    );
    expect(screen.queryByText(/vs last week/)).not.toBeInTheDocument();
  });
});
