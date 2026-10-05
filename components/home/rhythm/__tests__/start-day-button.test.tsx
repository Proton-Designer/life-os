import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickTime12 } from "@/components/ui/__tests__/time-field-helper";

const startDayAction = vi.fn(async () => {});
const startDayAtAction = vi.fn(async (_t: string): Promise<{ ok: true; alreadyStarted: boolean } | { ok: false; message: string }> => ({ ok: true, alreadyStarted: false }));
vi.mock("@/app/(app)/open/actions", () => ({ startDayAction: () => startDayAction(), startDayAtAction: (t: string) => startDayAtAction(t) }));

import { StartDayButton } from "../start-day-button";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

describe("StartDayButton — Woke earlier?", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
  });

  it("plain Start day is unchanged (positive control): one tap, no time picker involved", async () => {
    const user = userEvent.setup();
    render(<StartDayButton />);
    expect(screen.queryByTestId("woke-earlier-form")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("start-day"));
    expect(screen.getByTestId("start-day")).toHaveTextContent("Day started");
    await waitFor(() => expect(startDayAction).toHaveBeenCalledTimes(1));
    expect(startDayAtAction).not.toHaveBeenCalled();
  });

  it("'Woke earlier?' opens a 12-hour picker; choosing a time starts the day from it (stored 24-hour)", async () => {
    const user = userEvent.setup();
    render(<StartDayButton />);
    await user.click(screen.getByTestId("woke-earlier"));
    const go = screen.getByTestId("start-day-at");
    expect(go).toBeDisabled(); // nothing chosen yet
    await pickTime12(user, "Wake time", "7:15 AM");
    expect(go).toHaveTextContent("Start day from 7:15 AM");
    await user.click(go);
    expect(startDayAtAction).toHaveBeenCalledWith("07:15");
    await waitFor(() => expect(screen.getByTestId("start-day")).toHaveTextContent("Day started"));
    expect(screen.queryByTestId("woke-earlier-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("woke-earlier")).not.toBeInTheDocument();
    expect(startDayAction).not.toHaveBeenCalled();
  });

  it("a refused time (e.g. in the future) shows the reason and does NOT start the day", async () => {
    startDayAtAction.mockResolvedValueOnce({ ok: false, message: "That time hasn't happened yet today." });
    const user = userEvent.setup();
    render(<StartDayButton />);
    await user.click(screen.getByTestId("woke-earlier"));
    await pickTime12(user, "Wake time", "11:00 PM");
    await user.click(screen.getByTestId("start-day-at"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That time hasn't happened yet today.");
    expect(screen.getByTestId("start-day")).toHaveTextContent("Start day");
  });

  it("Cancel closes the picker and the link is back", async () => {
    const user = userEvent.setup();
    render(<StartDayButton />);
    await user.click(screen.getByTestId("woke-earlier"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("woke-earlier-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("woke-earlier")).toBeInTheDocument();
  });
});
