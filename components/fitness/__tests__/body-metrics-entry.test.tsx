import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BodyMetricsEntry } from "../body-metrics-entry";

describe("BodyMetricsEntry", () => {
  it("weight is always a passive affordance, no push/badge — just a plain button", () => {
    render(<BodyMetricsEntry waistDue={false} onLogWeight={vi.fn()} onLogWaist={vi.fn()} />);
    expect(screen.getByText("Log weight")).toBeInTheDocument();
  });

  it("the waist nudge only appears when waistDue is true — quiet in between", () => {
    render(<BodyMetricsEntry waistDue={false} onLogWeight={vi.fn()} onLogWaist={vi.fn()} />);
    expect(screen.queryByTestId("waist-nudge")).not.toBeInTheDocument();
  });

  it("shows the waist nudge when due", () => {
    render(<BodyMetricsEntry waistDue={true} onLogWeight={vi.fn()} onLogWaist={vi.fn()} />);
    expect(screen.getByTestId("waist-nudge")).toBeInTheDocument();
  });

  it("logging weight opens an inline field and calls onLogWeight with the number", async () => {
    const user = userEvent.setup();
    const onLogWeight = vi.fn().mockResolvedValue(undefined);
    render(<BodyMetricsEntry waistDue={false} onLogWeight={onLogWeight} onLogWaist={vi.fn()} />);
    await user.click(screen.getByText("Log weight"));
    await user.type(screen.getByLabelText("Weight (lb)"), "158");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onLogWeight).toHaveBeenCalledWith(158);
  });

  it("logging waist calls onLogWaist with the number", async () => {
    const user = userEvent.setup();
    const onLogWaist = vi.fn().mockResolvedValue(undefined);
    render(<BodyMetricsEntry waistDue={true} onLogWeight={vi.fn()} onLogWaist={onLogWaist} />);
    await user.click(screen.getByTestId("waist-nudge"));
    await user.type(screen.getByLabelText("Waist (in)"), "32.5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onLogWaist).toHaveBeenCalledWith(32.5);
  });
});
