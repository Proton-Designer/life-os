import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const cancelMock = vi.fn(async (_id: string) => ({ ok: true }));
vi.mock("@/app/(app)/personal/self-mastery-actions", () => ({ cancelAgentBookWork: (id: string) => cancelMock(id) }));
const refresh = vi.fn();
const stableRouter = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => stableRouter }));

import { AgentWorkCard } from "../agent-work-card";

const progress = { stage: "extracting_lessons", stageLabel: "Finding lessons", done: 12, total: 130, parked: true };

beforeEach(() => {
  vi.clearAllMocks();
  cancelMock.mockResolvedValue({ ok: true });
});

describe("AgentWorkCard", () => {
  it("says what it is waiting for, with the real numbers", () => {
    render(<AgentWorkCard bookId="b1" progress={progress} />);
    expect(screen.getByTestId("agent-work-card")).toHaveTextContent("Waiting for your agent: 12 of 130 steps done");
    expect(screen.getByTestId("agent-work-card")).toHaveTextContent("Finding lessons");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "9");
  });

  it("when the agent is between two steps it says it is working, not waiting", () => {
    render(<AgentWorkCard bookId="b1" progress={{ ...progress, parked: false }} />);
    expect(screen.getByTestId("agent-work-card")).toHaveTextContent("Your agent is working on this book: 12 of 130 steps done");
  });

  it("an unknown total (the stage has just started) does not show a made-up denominator", () => {
    render(<AgentWorkCard bookId="b1" progress={{ ...progress, done: 0, total: 0 }} />);
    expect(screen.getByTestId("agent-work-card")).not.toHaveTextContent("of 0");
  });

  it("Cancel asks first, then cancels the remaining steps and refreshes (the book becomes a retryable failure)", async () => {
    const user = userEvent.setup();
    render(<AgentWorkCard bookId="b1" progress={progress} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByText(/stops your agent's work on this book/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith("b1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("'Keep waiting' backs out without cancelling anything", async () => {
    const user = userEvent.setup();
    render(<AgentWorkCard bookId="b1" progress={progress} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep waiting" }));
    expect(cancelMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("a failed cancel says so instead of silently doing nothing", async () => {
    cancelMock.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    render(<AgentWorkCard bookId="b1" progress={progress} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't cancel/i);
  });
});
