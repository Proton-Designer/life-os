import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const saveMock = vi.fn();
vi.mock("@/app/(app)/settings/wind-down-actions", () => ({ saveWindDownPlan: (...a: unknown[]) => saveMock(...a) }));
import { WindDownPlanSettings } from "../wind-down-plan-settings";

describe("WindDownPlanSettings", () => {
  beforeEach(() => saveMock.mockReset());

  it("previews bedtime and wind-down start live from the three inputs", () => {
    render(<WindDownPlanSettings initialWakeTime="07:00" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    expect(screen.getByTestId("wind-down-preview")).toHaveTextContent("Lights out by 23:00 · wind-down starts 22:15");
  });

  it("shows no preview until a wake time is set", () => {
    render(<WindDownPlanSettings initialWakeTime={null} initialSleepNeedMinutes={null} initialWindDownMinutes={null} />);
    expect(screen.queryByTestId("wind-down-preview")).toBeNull();
  });

  it("saves the inputs in minutes and reports the derived times", async () => {
    saveMock.mockResolvedValue({ ok: true, bedtime: "23:00", windDownStart: "22:15" });
    const user = userEvent.setup();
    render(<WindDownPlanSettings initialWakeTime="07:00" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMock).toHaveBeenCalledWith({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45 });
    expect(await screen.findByText(/Lights out by 23:00; wind-down starts 22:15/)).toBeInTheDocument();
  });

  it("refuses an invalid plan before calling the server and says why", async () => {
    const user = userEvent.setup();
    render(<WindDownPlanSettings initialWakeTime="" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/wake time/i);
  });

  it("surfaces a server refusal (e.g. Sleep plan OFF)", async () => {
    saveMock.mockResolvedValue({ ok: false, message: "This feature is off." });
    const user = userEvent.setup();
    render(<WindDownPlanSettings initialWakeTime="07:00" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This feature is off.");
  });
});
