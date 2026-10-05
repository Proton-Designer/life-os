import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveWindDownPlan = vi.fn(async (_i: unknown): Promise<{ ok: true; bedtime: string; windDownStart: string } | { ok: false; message: string }> => ({ ok: true, bedtime: "23:45", windDownStart: "23:00" }));
vi.mock("@/app/(app)/settings/wind-down-actions", () => ({ saveWindDownPlan: (i: unknown) => saveWindDownPlan(i) }));

import { WakePlanNudge } from "../wake-plan-nudge";

const props = { plannedWake: "06:30", suggestedWake: "07:45", lateDays: 4, n: 5, minutesLate: 75, sleepNeedMinutes: 480, windDownMinutes: 45 };

describe("WakePlanNudge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says plainly how far the mornings run from the plan, in 12-hour time, without scolding", () => {
    render(<WakePlanNudge {...props} />);
    const box = screen.getByTestId("wake-plan-nudge");
    expect(box).toHaveTextContent("about 1h 15m after your planned wake time (6:30 AM) — 4 of 5 mornings");
    expect(screen.getByRole("button", { name: "Move my wake time to 7:45 AM" })).toBeInTheDocument();
    expect(box.textContent).not.toMatch(/\d{2}:\d{2}(?!\s?[AP]M)/); // no 24-hour clock text anywhere
  });

  it("one tap saves the suggested wake time with the user's own sleep need and wind-down, and confirms in 12-hour", async () => {
    const user = userEvent.setup();
    render(<WakePlanNudge {...props} />);
    await user.click(screen.getByTestId("wake-plan-adjust"));
    expect(saveWindDownPlan).toHaveBeenCalledWith({ wakeTime: "07:45", sleepNeedMinutes: 480, windDownMinutes: 45 });
    expect(await screen.findByRole("status")).toHaveTextContent("Done. Wake 7:45 AM, lights out by 11:45 PM, wind-down at 11:00 PM.");
    expect(screen.queryByTestId("wake-plan-adjust")).not.toBeInTheDocument(); // applied: the offer goes away
  });

  it("a plan with no explicit wind-down minutes does not send one (the core's default applies)", async () => {
    const user = userEvent.setup();
    render(<WakePlanNudge {...props} windDownMinutes={null} />);
    await user.click(screen.getByTestId("wake-plan-adjust"));
    expect(saveWindDownPlan).toHaveBeenCalledWith({ wakeTime: "07:45", sleepNeedMinutes: 480 });
  });

  it("a refusal shows its reason and keeps the offer", async () => {
    saveWindDownPlan.mockResolvedValueOnce({ ok: false, message: "This feature is off." });
    const user = userEvent.setup();
    render(<WakePlanNudge {...props} />);
    await user.click(screen.getByTestId("wake-plan-adjust"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This feature is off.");
    expect(screen.getByTestId("wake-plan-adjust")).toBeInTheDocument();
  });

  it("under an hour late it says minutes, not '0h'", () => {
    render(<WakePlanNudge {...props} minutesLate={45} />);
    expect(screen.getByTestId("wake-plan-nudge")).toHaveTextContent("about 45 min after");
  });
});
