import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const correctMock = vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; message?: string }> => ({ ok: true }));
vi.mock("@/app/(app)/insights/actions", () => ({ correctSessionLength: (...a: unknown[]) => correctMock(...a) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SessionLogPanel, type SessionLogRow } from "../session-log-panel";

const ROW: SessionLogRow = { id: "s1", kindLabel: "Deep Study", dayLabel: "Mon, Oct 12", startLabel: "10:00 PM", endLabel: "12:00 PM next day", durationMinutes: 840, goalMinutes: 60, suspicious: true };

describe("SessionLogPanel", () => {
  it("flags a too-long session and saves the corrected minutes", async () => {
    render(<SessionLogPanel rows={[ROW]} />);
    expect(screen.getByText("Looks too long")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fix length" }));
    const input = screen.getByTestId("session-fix-minutes");
    expect(input).toHaveValue(60); // prefilled with the planned time
    await user.clear(input);
    await user.type(input, "75");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(correctMock).toHaveBeenCalledWith("s1", 75);
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's message and stays open when the save is refused", async () => {
    correctMock.mockResolvedValueOnce({ ok: false, message: "That's not shorter than the recorded time." });
    render(<SessionLogPanel rows={[ROW]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fix length" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That's not shorter than the recorded time.")).toBeInTheDocument();
  });
});
