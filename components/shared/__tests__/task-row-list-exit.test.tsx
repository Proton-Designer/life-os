import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskRowList, type TaskRowItem } from "../task-row-list";

// Kept in its OWN file on purpose: task-row-list.test.tsx has a test whose onComplete never resolves, which leaves a
// transition open for the rest of that file. React entangles later transitions with it, so a useOptimistic revert (the
// very bug under test) never happens there and these tests passed against the buggy code when they lived in that file.

function toggleItem(overrides: Partial<TaskRowItem> & Pick<TaskRowItem, "id" | "title">): TaskRowItem {
  return { domain: "school", mode: "toggle", completedAtIso: null, ...overrides };
}

describe("TaskRowList: a completed row never reappears in Pending (Package F)", () => {
  // Flush React inside act: outside it a transition ending and its optimistic revert are not committed the way they are
  // in a browser, which is how a first draft of these tests passed against the buggy code.
  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const rowName = 'Mark "Read chapter 4" done';
  const base = () => [toggleItem({ id: "t1", title: "Read chapter 4" }), toggleItem({ id: "t2", title: "Other task" })];

  async function tickAndSettle(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: rowName }));
    await advance(1000); // past the confirm beat and the exit fade; onComplete has resolved
  }

  it("onComplete resolves but the items prop is still the OLD list: the row is NOT back in Pending (it fails on the old useOptimistic code)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={base()} onComplete={vi.fn(async () => {})} />);
      await tickAndSettle(user);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      await advance(3000); // "the debounced refresh has not landed yet"
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: 'Mark "Other task" done' })).toBeInTheDocument(); // siblings untouched
      await user.click(screen.getByText("Completed"));
      expect(screen.getByText("Read chapter 4")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the save is slower than the beat: the row leaves at the beat and stays gone while the write is in flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let resolveSave!: () => void;
      const onComplete = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={base()} onComplete={onComplete} />);
      await tickAndSettle(user);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      resolveSave();
      await advance(100);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an UNRELATED refresh (new items array, the row still pending) must not resurrect it; the confirming refresh then takes over with no flash", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<TaskRowList items={base()} onComplete={vi.fn(async () => {})} />);
      await tickAndSettle(user);
      rerender(<TaskRowList items={base()} onComplete={vi.fn(async () => {})} />); // fresh data that predates the write
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      rerender(<TaskRowList items={[toggleItem({ id: "t1", title: "Read chapter 4", completedAtIso: "2026-10-07T10:00:00.000Z" }), base()[1]!]} onComplete={vi.fn(async () => {})} />);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      await user.click(screen.getByText("Completed"));
      expect(screen.getByText("Read chapter 4")).toBeInTheDocument();
      // and an unrelated refresh AFTER the server caught up still shows it completed, never pending
      rerender(<TaskRowList items={[toggleItem({ id: "t1", title: "Read chapter 4", completedAtIso: "2026-10-07T10:00:00.000Z" }), base()[1]!]} onComplete={vi.fn(async () => {})} />);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a save that fails AFTER the row already left puts it back in Pending with its inline error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onComplete = vi.fn(() => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("network")), 900)));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={base()} onComplete={onComplete} />);
      await user.click(screen.getByRole("button", { name: rowName }));
      await advance(800); // beat (550) + fade (200) done, row gone, write still in flight (fails at 900)
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
      await advance(300); // the write now fails
      expect(screen.getByRole("button", { name: rowName })).toBeInTheDocument();
      expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
      // not left looking complete, and tappable again
      expect(screen.getByRole("button", { name: rowName })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("exit motion: the struck row stays mounted (marked exiting) for a short fade after the beat, then is removed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={base()} onComplete={vi.fn(async () => {})} />);
      await user.click(screen.getByRole("button", { name: rowName }));
      await advance(300);
      expect(screen.getByRole("button", { name: rowName }).closest("li")).not.toHaveAttribute("data-exiting"); // still the confirmation beat
      await advance(300); // past the beat, inside the fade
      expect(screen.getByRole("button", { name: rowName }).closest("li")).toHaveAttribute("data-exiting", "true");
      await advance(400);
      expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a confirmed Remove also stays gone while the items prop is still the old list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={base()} onComplete={vi.fn(async () => {})} onRemove={vi.fn(async () => {})} />);
      await user.click(screen.getByRole("button", { name: "Remove Read chapter 4" }));
      await advance(1000);
      expect(screen.queryByText("Read chapter 4")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a confirmed Delay also stays gone while the items prop is still the old list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TaskRowList items={[toggleItem({ id: "t1", title: "Read chapter 4", canDelay: true })]} onComplete={vi.fn(async () => {})} onDelay={vi.fn(async () => {})} />);
      await user.click(screen.getByRole("button", { name: 'Delay "Read chapter 4" until tomorrow' }));
      await advance(1000);
      expect(screen.queryByText("Read chapter 4")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
