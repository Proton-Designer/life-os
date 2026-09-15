import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorriesPageClient } from "../worries-page-client";
import type { Worry } from "@/lib/night-plan/worries";

const { markWorryHandledMock, reopenWorryMock, recordWorryOutcomeMock } = vi.hoisted(() => ({
  markWorryHandledMock: vi.fn(async (_id: string) => ({ ok: true as const })),
  reopenWorryMock: vi.fn(async (_id: string) => ({ ok: true as const })),
  recordWorryOutcomeMock: vi.fn(async (_id: string, _outcome: string) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/worries/actions", () => ({
  markWorryHandled: markWorryHandledMock,
  reopenWorry: reopenWorryMock,
  recordWorryOutcome: recordWorryOutcomeMock,
}));

function makeWorry(overrides: Partial<Worry> = {}): Worry {
  return {
    id: "w1",
    title: "Rent renewal",
    createdAt: "2026-09-14T00:00:00Z",
    completed: false,
    completedAt: null,
    outcome: null,
    ...overrides,
  };
}

describe("WorriesPageClient (P2-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the Monday Anti-Worry Hour panel entirely when isMonday is false", () => {
    render(<WorriesPageClient open={[makeWorry()]} handled={[]} isMonday={false} />);
    expect(screen.queryByText("Monday Anti-Worry Hour")).not.toBeInTheDocument();
    // The plain list is still there, unaffected.
    expect(screen.getByText("Rent renewal")).toBeInTheDocument();
  });

  it("shows the panel on Mondays, and picking an outcome there moves the worry to Handled AND removes it from the plain open list too — same shared state, not two out-of-sync copies", async () => {
    const user = userEvent.setup();
    render(<WorriesPageClient open={[makeWorry()]} handled={[]} isMonday={true} />);

    expect(screen.getByText("Monday Anti-Worry Hour")).toBeInTheDocument();
    // The worry appears twice while open: once in the panel, once in the plain list.
    expect(screen.getAllByText("Rent renewal")).toHaveLength(2);

    const panel = screen.getByText("Monday Anti-Worry Hour").closest("div")!.parentElement!;
    await user.click(within(panel).getByRole("button", { name: "Took action" }));

    expect(recordWorryOutcomeMock).toHaveBeenCalledWith("w1", "took_action");
    // Gone from the open side entirely (panel says "every worry has an
    // outcome", the plain list says "Everything's handled") -- only the
    // "N handled" toggle still names it, unrevealed by default.
    expect(screen.getByText("Every open worry has an outcome. Nice.")).toBeInTheDocument();
    expect(screen.getByText("Everything's handled.")).toBeInTheDocument();
    expect(screen.getByText("1 worked through today")).toBeInTheDocument();
  });

  it("a plain 'Handled' tap from the list (not the panel) never sets an outcome", async () => {
    const user = userEvent.setup();
    render(<WorriesPageClient open={[makeWorry()]} handled={[]} isMonday={false} />);

    await user.click(screen.getByRole("button", { name: "Handled" }));

    expect(markWorryHandledMock).toHaveBeenCalledWith("w1");
    expect(recordWorryOutcomeMock).not.toHaveBeenCalled();
  });

  it("reopening a handled worry with a recorded outcome clears it — a reopened worry has no stale outcome", async () => {
    const user = userEvent.setup();
    render(
      <WorriesPageClient
        open={[]}
        handled={[makeWorry({ completed: true, completedAt: "2026-09-14T01:00:00Z", outcome: "resolved" })]}
        isMonday={false}
      />
    );

    await user.click(screen.getByRole("button", { name: /1 handled/i }));
    expect(screen.getByText("Resolved")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(reopenWorryMock).toHaveBeenCalledWith("w1");
    expect(screen.getByText("Rent renewal")).toBeInTheDocument();
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });
});
