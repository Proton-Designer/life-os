import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickTime12 } from "@/components/ui/__tests__/time-field-helper";

const setUpDay = vi.fn(async (_i: unknown): Promise<{ ok: true; bedtime: string; windDownStart: string; stepsCreated: number } | { ok: false; message: string }> => ({
  ok: true,
  bedtime: "22:30",
  windDownStart: "21:45",
  stepsCreated: 2,
}));
vi.mock("@/app/(app)/day-setup/actions", () => ({ setUpDay: (i: unknown) => setUpDay(i) }));

import { DaySetupCard } from "../day-setup-card";

describe("DaySetupCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("offers the setup, and 'Not now' hides it and snoozes it for two weeks", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DaySetupCard />);
    expect(await screen.findByTestId("day-setup-card")).toBeInTheDocument();
    await user.click(screen.getByTestId("day-setup-later"));
    expect(screen.queryByTestId("day-setup-card")).not.toBeInTheDocument();
    const until = Number(window.localStorage.getItem("lifeos:day-setup-snooze-until"));
    expect(until - Date.now()).toBeGreaterThan(13 * 86_400_000);
    unmount();
    render(<DaySetupCard />); // still snoozed on the next visit
    await waitFor(() => expect(screen.queryByTestId("day-setup-card")).not.toBeInTheDocument());
  });

  it("an expired snooze offers it again", async () => {
    window.localStorage.setItem("lifeos:day-setup-snooze-until", String(Date.now() - 1000));
    render(<DaySetupCard />);
    expect(await screen.findByTestId("day-setup-card")).toBeInTheDocument();
  });

  it("the dialog needs a wake time, previews bedtime/wind-down in 12-hour, and saves 24-hour values with the steps", async () => {
    const user = userEvent.setup();
    render(<DaySetupCard />);
    await user.click(await screen.findByTestId("day-setup-open"));
    const dialog = await screen.findByTestId("day-setup-dialog");
    expect(within(dialog).getByTestId("day-setup-save")).toBeDisabled(); // no wake time yet
    expect(within(dialog).queryByTestId("day-setup-preview")).not.toBeInTheDocument();

    await pickTime12(user, "Wake time", "6:30 AM");
    expect(within(dialog).getByTestId("day-setup-preview")).toHaveTextContent("Lights out by 10:30 PM · wind-down starts 9:45 PM");
    expect(dialog.querySelector('input[type="time"]')).toBeNull();

    await user.type(within(dialog).getByLabelText("Morning step 1"), "Drink water");
    await user.type(within(dialog).getByLabelText("Morning step 2"), "Stretch");
    await user.click(within(dialog).getByTestId("day-setup-save"));
    expect(setUpDay).toHaveBeenCalledWith({ wakeTime: "06:30", sleepNeedMinutes: 480, windDownMinutes: 45, routineSteps: ["Drink water", "Stretch", ""] });
    const done = await screen.findByTestId("day-setup-done");
    expect(done).toHaveTextContent("Lights out by 10:30 PM, wind-down at 9:45 PM");
    expect(done).toHaveTextContent("morning routine will be on Home tomorrow");
  });

  it("a server refusal stays in the dialog with its reason and does not close it", async () => {
    setUpDay.mockResolvedValueOnce({ ok: false, message: "Sleep need must be between 6 and 10 hours." });
    const user = userEvent.setup();
    render(<DaySetupCard />);
    await user.click(await screen.findByTestId("day-setup-open"));
    await pickTime12(user, "Wake time", "7:00 AM");
    await user.click(screen.getByTestId("day-setup-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sleep need must be between 6 and 10 hours.");
    expect(screen.getByTestId("day-setup-dialog")).toBeInTheDocument();
  });

  it("sleep-only (no steps) says nothing about a routine", async () => {
    setUpDay.mockResolvedValueOnce({ ok: true, bedtime: "22:30", windDownStart: "21:45", stepsCreated: 0 });
    const user = userEvent.setup();
    render(<DaySetupCard />);
    await user.click(await screen.findByTestId("day-setup-open"));
    await pickTime12(user, "Wake time", "6:30 AM");
    await user.click(screen.getByTestId("day-setup-save"));
    expect(await screen.findByTestId("day-setup-done")).not.toHaveTextContent(/routine/);
  });
});
