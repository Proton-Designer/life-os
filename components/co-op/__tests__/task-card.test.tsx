import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskCard } from "../task-card";
import type { CoopTaskRow } from "@/lib/coop/tasks";

function task(overrides: Partial<CoopTaskRow> = {}): CoopTaskRow {
  return {
    id: "t1",
    title: "Renew the permit",
    deadline: null,
    status: "in_progress",
    blockedFrom: null,
    blockedReason: null,
    blockedSince: null,
    createdAt: "2026-08-20T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function actions(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    onAdvance: vi.fn(),
    onRetreat: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

describe("TaskCard — blocking with an optional reason", () => {
  it("Block opens a dialog with an optional reason field, not an immediate block", async () => {
    const user = userEvent.setup();
    const onBlock = vi.fn();
    render(<TaskCard task={task()} {...actions({ onBlock })} timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "Mark blocked — waiting on something outside your control" }));
    expect(onBlock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/what.*blocked on/i)).toBeInTheDocument();
  });

  it("submitting the Block dialog with no text still blocks — reason is optional", async () => {
    const user = userEvent.setup();
    const onBlock = vi.fn();
    render(<TaskCard task={task()} {...actions({ onBlock })} timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "Mark blocked — waiting on something outside your control" }));
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenCalledWith("");
  });

  it("submitting the Block dialog with text passes it straight through, untrimmed — trimming is the core's job", async () => {
    const user = userEvent.setup();
    const onBlock = vi.fn();
    render(<TaskCard task={task()} {...actions({ onBlock })} timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "Mark blocked — waiting on something outside your control" }));
    await user.type(screen.getByLabelText(/what.*blocked on/i), "waiting on legal");
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(onBlock).toHaveBeenCalledWith("waiting on legal");
  });

  it("Cancel closes the dialog without blocking", async () => {
    const user = userEvent.setup();
    const onBlock = vi.fn();
    render(<TaskCard task={task()} {...actions({ onBlock })} timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "Mark blocked — waiting on something outside your control" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBlock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TaskCard — disclosing what a blocked task is blocked on", () => {
  it("renders the Blocked indicator as a real button, not a static badge", () => {
    render(
      <TaskCard
        task={task({ status: "blocked", blockedFrom: "in_progress", blockedReason: "waiting on legal", blockedSince: "2026-09-07T12:00:00Z" })}
        {...actions()}
        timezone="America/Chicago"
      />
    );
    expect(screen.getByRole("button", { name: /blocked/i })).toBeInTheDocument();
  });

  it("shows the reason and both a relative age and the absolute date when pressed", async () => {
    const user = userEvent.setup();
    render(
      <TaskCard
        task={task({ status: "blocked", blockedFrom: "in_progress", blockedReason: "waiting on legal", blockedSince: "2026-09-07T12:00:00Z" })}
        {...actions()}
        timezone="America/Chicago"
        now={new Date("2026-09-10T12:00:00Z")}
      />
    );
    await user.click(screen.getByRole("button", { name: /blocked/i }));
    expect(screen.getByText("waiting on legal")).toBeInTheDocument();
    expect(screen.getByText(/3d/)).toBeInTheDocument();
    expect(screen.getByText(/Sep\. 7th/)).toBeInTheDocument();
  });

  it("shows 'No reason given' when blockedReason is null", async () => {
    const user = userEvent.setup();
    render(
      <TaskCard
        task={task({ status: "blocked", blockedFrom: "in_progress", blockedReason: null, blockedSince: "2026-09-07T12:00:00Z" })}
        {...actions()}
        timezone="America/Chicago"
        now={new Date("2026-09-10T12:00:00Z")}
      />
    );
    await user.click(screen.getByRole("button", { name: /blocked/i }));
    expect(screen.getByText("No reason given")).toBeInTheDocument();
  });

  // The one production row blocked before migration 148 existed — never
  // backfilled with a manufactured timestamp (148's own instruction: a
  // proxy timestamp is exactly the mistake 147's corrective migration was
  // needed for). Must read as an honest gap, never a crash or a guess.
  it("shows 'blocked, start date not recorded' when blockedSince is null, and never crashes or guesses a date", async () => {
    const user = userEvent.setup();
    render(
      <TaskCard
        task={task({ status: "blocked", blockedFrom: "in_progress", blockedReason: null, blockedSince: null })}
        {...actions()}
        timezone="America/Chicago"
      />
    );
    await user.click(screen.getByRole("button", { name: /blocked/i }));
    expect(screen.getByText("blocked, start date not recorded")).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
