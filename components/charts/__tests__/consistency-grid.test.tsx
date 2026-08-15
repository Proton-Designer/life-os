import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ConsistencyGrid } from "../consistency-grid";

const STATUS_COLOR = { on_time: "--accent-business", qada: "--accent-deen", missed: "--destructive" };
const STATUS_LABEL = { on_time: "On time", qada: "Qada", missed: "Missed" };

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
        statusColorVar={STATUS_COLOR}
        statusLabel={STATUS_LABEL}
      />
    );
    expect(screen.getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026-08-14: On time/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026-08-15: Missed/ })).toBeInTheDocument();
  });

  it("shows an empty state instead of crashing on zero rows", () => {
    render(<ConsistencyGrid rows={[]} statusColorVar={STATUS_COLOR} statusLabel={STATUS_LABEL} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("reveals a tooltip with the date and status on hover", async () => {
    const user = userEvent.setup();
    render(
      <ConsistencyGrid
        rows={[{ label: "Fajr", cells: [{ date: "2026-08-15", status: "qada" }] }]}
        statusColorVar={STATUS_COLOR}
        statusLabel={STATUS_LABEL}
      />
    );
    await user.hover(screen.getByRole("button", { name: /2026-08-15: Qada/ }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("2026-08-15: Qada");
  });
});
