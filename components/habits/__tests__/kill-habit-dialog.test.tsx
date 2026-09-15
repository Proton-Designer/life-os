import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { KillHabitDialog } from "../kill-habit-dialog";
import type { KillHabitActionResult } from "@/app/(app)/habits/actions";

const killIdentityHabitActionMock = vi.fn(async (..._args: unknown[]): Promise<KillHabitActionResult> => ({ ok: true }));
vi.mock("@/app/(app)/habits/actions", () => ({
  killIdentityHabitAction: (...args: unknown[]) => killIdentityHabitActionMock(...args),
}));

describe("KillHabitDialog (P2-11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    killIdentityHabitActionMock.mockResolvedValue({ ok: true });
  });

  it("below the escalation threshold: shows a plain confirm, no reason textarea, Kill enabled immediately", () => {
    render(<KillHabitDialog open onOpenChange={vi.fn()} habitId="h1" identityStatement="the athlete" voteCount={5} onKilled={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/why are you killing/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kill this habit" })).not.toBeDisabled();
  });

  it("THE REGRESSION GUARD: at/above the threshold, Kill stays disabled until real text is entered", async () => {
    const user = userEvent.setup();
    render(<KillHabitDialog open onOpenChange={vi.fn()} habitId="h1" identityStatement="the athlete" voteCount={14} onKilled={vi.fn()} />);
    const killButton = screen.getByRole("button", { name: "Kill this habit" });
    expect(killButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/why are you killing/i), "   "); // whitespace only
    expect(killButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/why are you killing/i), "a real reason");
    expect(killButton).not.toBeDisabled();
  });

  it("confirming below the threshold calls the action with an undefined reason", async () => {
    const onKilled = vi.fn();
    const user = userEvent.setup();
    render(<KillHabitDialog open onOpenChange={vi.fn()} habitId="h1" identityStatement="the athlete" voteCount={2} onKilled={onKilled} />);
    await user.click(screen.getByRole("button", { name: "Kill this habit" }));

    await waitFor(() => expect(killIdentityHabitActionMock).toHaveBeenCalledWith("h1", undefined));
    await waitFor(() => expect(onKilled).toHaveBeenCalledWith("h1"));
  });

  it("confirming at/above the threshold calls the action with the trimmed reason", async () => {
    const onKilled = vi.fn();
    const user = userEvent.setup();
    render(<KillHabitDialog open onOpenChange={vi.fn()} habitId="h1" identityStatement="the athlete" voteCount={20} onKilled={onKilled} />);
    await user.type(screen.getByPlaceholderText(/why are you killing/i), "  I no longer identify with this.  ");
    await user.click(screen.getByRole("button", { name: "Kill this habit" }));

    await waitFor(() => expect(killIdentityHabitActionMock).toHaveBeenCalledWith("h1", "I no longer identify with this."));
    await waitFor(() => expect(onKilled).toHaveBeenCalledWith("h1"));
  });

  it("a requires_reason server response (a stale client voteCount) shows an inline error rather than closing", async () => {
    killIdentityHabitActionMock.mockResolvedValue({ ok: false, reason: "requires_reason" });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    // voteCount=2 makes the CLIENT think no reason is needed, but the server disagrees.
    render(<KillHabitDialog open onOpenChange={onOpenChange} habitId="h1" identityStatement="the athlete" voteCount={2} onKilled={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Kill this habit" }));

    expect(await screen.findByText(/needs a reason/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("a plain error result shows the error message", async () => {
    killIdentityHabitActionMock.mockResolvedValue({ error: "Something went wrong. Please try again." });
    const user = userEvent.setup();
    render(<KillHabitDialog open onOpenChange={vi.fn()} habitId="h1" identityStatement="the athlete" voteCount={2} onKilled={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Kill this habit" }));

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("Cancel closes without calling the action", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<KillHabitDialog open onOpenChange={onOpenChange} habitId="h1" identityStatement="the athlete" voteCount={2} onKilled={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(killIdentityHabitActionMock).not.toHaveBeenCalled();
  });
});
