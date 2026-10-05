import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const saveMock = vi.fn();
vi.mock("@/app/(app)/settings/wind-down-actions", () => ({ saveWindDownPlan: (...a: unknown[]) => saveMock(...a) }));
import { WindDownPlanSettings } from "../wind-down-plan-settings";
import { pickTime12, readTime12 } from "@/components/ui/__tests__/time-field-helper";

describe("WindDownPlanSettings", () => {
  beforeEach(() => saveMock.mockReset());

  it("previews bedtime and wind-down start live from the three inputs", () => {
    render(<WindDownPlanSettings initialWakeTime="07:00" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    expect(screen.getByTestId("wind-down-preview")).toHaveTextContent("Lights out by 11:00 PM · wind-down starts 10:15 PM");
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
    expect(await screen.findByText(/Lights out by 11:00 PM; wind-down starts 10:15 PM/)).toBeInTheDocument();
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

  it("the wake time is a 12-hour control: shows 7:00 AM for a stored 07:00 and stores a PM pick as 24-hour", async () => {
    saveMock.mockResolvedValue({ ok: true, bedtime: "23:00", windDownStart: "22:15" });
    const user = userEvent.setup();
    render(<WindDownPlanSettings initialWakeTime="07:00" initialSleepNeedMinutes={480} initialWindDownMinutes={45} />);
    expect(readTime12("Wake time")).toBe("7:00 AM");
    expect(document.querySelector('input[type="time"]')).toBeNull();
    await pickTime12(user, "Wake time", "6:30 AM");
    expect(screen.getByTestId("wind-down-preview")).toHaveTextContent("Lights out by 10:30 PM · wind-down starts 9:45 PM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMock).toHaveBeenCalledWith({ wakeTime: "06:30", sleepNeedMinutes: 480, windDownMinutes: 45 });
  });
});

