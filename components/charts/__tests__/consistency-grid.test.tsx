import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConsistencyGrid } from "../consistency-grid";

const STATUS_STYLE = {
  on_time: { colorVar: "--accent-business", treatment: "solid" as const, label: "On time" },
  qada: { colorVar: "--accent-deen", treatment: "hatch" as const, label: "Qada" },
  missed: { colorVar: "--destructive", treatment: "hollow" as const, label: "Missed" },
};

describe("ConsistencyGrid", () => {
  it("renders a row label per row and a cell per day", () => {
    render(
      <ConsistencyGrid
        rows={[
          {
            label: "Fajr",
            cells: [
              { date: "2026-08-14", status: "on_time" },
              { date: "2026-08-15", status: "missed" },
            ],
          },
        ]}
        statusStyle={STATUS_STYLE}
      />
    );
    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026-08-14: On time/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026-08-15: Missed/ })).toBeInTheDocument();
  });

  it("shows an empty state instead of crashing on zero rows", () => {
    render(<ConsistencyGrid rows={[]} statusStyle={STATUS_STYLE} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("reveals a tooltip with the date and status on hover", async () => {
    const user = userEvent.setup();
    render(
      <ConsistencyGrid
        rows={[{ label: "Fajr", cells: [{ date: "2026-08-15", status: "qada" }] }]}
        statusStyle={STATUS_STYLE}
      />
    );
    await user.hover(screen.getByRole("button", { name: /2026-08-15: Qada/ }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("2026-08-15: Qada");
  });

  it("gives each status a distinct fill treatment, not color alone (the required a11y fix)", () => {
    render(
      <ConsistencyGrid
        rows={[
          {
            label: "Fajr",
            cells: [
              { date: "d1", status: "on_time" },
              { date: "d2", status: "qada" },
              { date: "d3", status: "missed" },
            ],
          },
        ]}
        statusStyle={STATUS_STYLE}
      />
    );
    const onTime = screen.getByRole("button", { name: /d1: On time/ });
    const qada = screen.getByRole("button", { name: /d2: Qada/ });
    const missed = screen.getByRole("button", { name: /d3: Missed/ });
    expect(onTime.style.backgroundColor).toBe("var(--accent-business)");
    expect(qada.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(missed.style.border).toContain("--destructive");
    expect(missed.style.backgroundColor).toBe("transparent");
  });

  it("gives every cell a fixed minimum width (not flex-1) and pins row labels — the narrow-viewport fix", () => {
    // jsdom reports zero layout dimensions, so the scroll-to-most-recent-day
    // mount effect can't be meaningfully asserted here (it early-returns
    // whenever scrollWidth <= clientWidth, which is always true in jsdom) —
    // that behavior is verified live, same as the Day Ribbon's identical
    // pattern. This locks in the structural half of the fix: cells no
    // longer shrink to fit (that's what produced ~6.5px cells at 390px),
    // and labels stay pinned to the scroll container's left edge.
    render(
      <ConsistencyGrid
        rows={[{ label: "Fajr", cells: [{ date: "d1", status: "on_time" }] }]}
        statusStyle={STATUS_STYLE}
      />
    );
    const cellWrapper = screen.getByRole("button", { name: /d1: On time/ }).parentElement;
    expect(cellWrapper?.className).toContain("w-4");
    expect(cellWrapper?.className).toContain("shrink-0");
    expect(cellWrapper?.className).not.toContain("flex-1");
    expect(screen.getByText("Fajr").className).toContain("sticky");
  });

  it("renders a legend showing every status's treatment and label", () => {
    render(
      <ConsistencyGrid
        rows={[{ label: "Fajr", cells: [{ date: "d1", status: "on_time" }] }]}
        statusStyle={STATUS_STYLE}
      />
    );
    expect(screen.getByText("On time")).toBeInTheDocument();
    expect(screen.getByText("Qada")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });
});
