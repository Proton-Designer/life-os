import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskRowList, type TaskRowItem, type TaskLogResult } from "../task-row-list";

function toggleItem(overrides: Partial<TaskRowItem> & Pick<TaskRowItem, "id" | "title">): TaskRowItem {
  return {
    domain: "school",
    mode: "toggle",
    completedAtIso: null,
    ...overrides,
  };
}

function logItem(overrides: Partial<TaskRowItem> & Pick<TaskRowItem, "id" | "title">): TaskRowItem {
  return {
    domain: "fitness",
    mode: "log",
    completedAtIso: null,
    ...overrides,
  };
}

describe("TaskRowList", () => {
  it("responds to a click anywhere on the row, not just a small circle", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[toggleItem({ id: "t1", title: "Read chapter 4" })]}
        onComplete={onComplete}
        onLog={onLog}
      />
    );

    // The whole button (aria-labeled by the row) is the hit target — click
    // via its accessible role, exactly what the row's own title text sits
    // inside, not a separate nested control.
    await user.click(screen.getByRole("button", { name: 'Mark "Read chapter 4" done' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows the green check + strikethrough instantly on click, before the server call resolves", async () => {
    const onComplete = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const user = userEvent.setup();
    render(
      <TaskRowList items={[toggleItem({ id: "t1", title: "Read chapter 4" })]} onComplete={onComplete} onLog={onLog} />
    );

    const row = screen.getByRole("button", { name: 'Mark "Read chapter 4" done' });
    await user.click(row);

    // Still on screen (not yet moved to Completed) but visually marked done.
    expect(screen.getByText("Read chapter 4")).toHaveClass("line-through");
  });

  it("moves a completed row into the collapsed Completed section after the confirm beat, once the server call actually succeeds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onComplete = vi.fn(async () => {});
      const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <TaskRowList
          items={[toggleItem({ id: "t1", title: "Read chapter 4" })]}
          onComplete={onComplete}
          onLog={onLog}
        />
      );

      await user.click(screen.getByRole("button", { name: 'Mark "Read chapter 4" done' }));
      await vi.advanceTimersByTimeAsync(600);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: 'Mark "Read chapter 4" done' })).not.toBeInTheDocument();
      });
      expect(screen.getByText("Completed")).toBeInTheDocument();
      // Collapsed by default — only the label shows until expanded.
      expect(screen.queryByText("Read chapter 4")).not.toBeInTheDocument();

      await user.click(screen.getByText("Completed"));
      expect(screen.getByText("Read chapter 4")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows already-completed items (completedAtIso set) directly in the collapsed Completed section, sorted oldest-first", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[
          toggleItem({ id: "t1", title: "Second done", completedAtIso: "2026-08-17T15:00:00.000Z" }),
          toggleItem({ id: "t2", title: "First done", completedAtIso: "2026-08-17T10:00:00.000Z" }),
        ]}
        onComplete={onComplete}
        onLog={onLog}
      />
    );

    expect(screen.queryByText("First done")).not.toBeInTheDocument();
    await user.click(screen.getByText("Completed"));

    const rows = screen.getAllByText(/done$/);
    expect(rows.map((r) => r.textContent)).toEqual(["First done", "Second done"]);
  });

  it("reverts to uncompleted and shows an inline error when onComplete rejects", async () => {
    const onComplete = vi.fn(async () => {
      throw new Error("network");
    });
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const user = userEvent.setup();
    render(
      <TaskRowList items={[toggleItem({ id: "t1", title: "Read chapter 4" })]} onComplete={onComplete} onLog={onLog} />
    );

    await user.click(screen.getByRole("button", { name: 'Mark "Read chapter 4" done' }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
    });
    // Still active, not moved to Completed.
    expect(screen.getByRole("button", { name: 'Mark "Read chapter 4" done' })).toBeInTheDocument();
  });

  it("opens a count log dialog on tap for a log-mode item, and completes it via Log when the target is met", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: true }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[logItem({ id: "f1", title: "Pull-ups", log: { kind: "count", unit: "reps", target: 30, current: 10 } })]}
        onComplete={onComplete}
        onLog={onLog}
      />
    );

    await user.click(screen.getByRole("button", { name: "Log Pull-ups" }));
    expect(screen.getByText("10/30 reps so far")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Add reps"), "20");
    await user.click(screen.getByRole("button", { name: "Log" }));

    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1" }),
      { kind: "count", value: 20 }
    );
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("updates progress in place (no completion) when a count log doesn't meet the target", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false, current: 15 }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[logItem({ id: "f1", title: "Pull-ups", log: { kind: "count", unit: "reps", target: 30, current: 10 } })]}
        onComplete={onComplete}
        onLog={onLog}
      />
    );

    await user.click(screen.getByRole("button", { name: "Log Pull-ups" }));
    await user.type(screen.getByPlaceholderText("Add reps"), "5");
    await user.click(screen.getByRole("button", { name: "Log" }));

    await waitFor(() => {
      expect(screen.getByText("15/30 reps")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Log Pull-ups" })).toBeInTheDocument();
  });

  it("supports a choice log", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: true }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[
          logItem({
            id: "q1",
            title: "Quiz result",
            log: { kind: "choice", options: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }] },
          }),
        ]}
        onComplete={onComplete}
        onLog={onLog}
      />
    );

    await user.click(screen.getByRole("button", { name: "Log Quiz result" }));
    await user.click(screen.getByRole("button", { name: "Fail" }));
    await user.click(screen.getByRole("button", { name: "Log" }));

    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), { kind: "choice", value: "fail" });
  });

  it("does not render a Remove control when onRemove is omitted (Home's usage)", () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    render(
      <TaskRowList items={[toggleItem({ id: "t1", title: "Fajr" })]} onComplete={onComplete} onLog={onLog} />
    );

    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("removes a row via the Remove control without completing it, when onRemove is provided", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const onRemove = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[toggleItem({ id: "t1", title: "Duplicate task" })]}
        onComplete={onComplete}
        onLog={onLog}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove Duplicate task" }));

    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Duplicate task")).not.toBeInTheDocument();
    });
  });

  it("clicking Remove does not also trigger the row's own completion", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const onRemove = vi.fn(async () => {});
    const user = userEvent.setup();
    const { container } = render(
      <TaskRowList
        items={[toggleItem({ id: "t1", title: "Duplicate task" })]}
        onComplete={onComplete}
        onLog={onLog}
        onRemove={onRemove}
      />
    );

    const row = within(container).getByRole("button", { name: "Remove Duplicate task" });
    await user.click(row);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("renders a Remove control on an already-completed row too", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const onRemove = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[toggleItem({ id: "t1", title: "Done already", completedAtIso: "2026-08-17T10:00:00.000Z" })]}
        onComplete={onComplete}
        onLog={onLog}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getByText("Completed"));
    await user.click(screen.getByRole("button", { name: "Remove Done already" }));

    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("shows the caller's emptyState when there's nothing pending or completed", () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    render(
      <TaskRowList items={[]} onComplete={onComplete} onLog={onLog} emptyState={<p>Nothing here</p>} />
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("shows the caller's emptyState ABOVE the Completed section when nothing is pending but something is completed — the production regression (2026-08-25)", async () => {
    const onComplete = vi.fn(async () => {});
    const onLog = vi.fn(async (): Promise<TaskLogResult> => ({ completed: false }));
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[toggleItem({ id: "t1", title: "Fajr", completedAtIso: "2026-08-17T10:00:00.000Z" })]}
        onComplete={onComplete}
        onLog={onLog}
        emptyState={<p>All clear</p>}
      />
    );

    // Previously the active region rendered a bare empty <ul> instead of
    // emptyState the moment ANYTHING was completed, so this message was
    // silently suppressed exactly in this state — nothing pending, but not
    // literally nothing overall.
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completed" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByText("Fajr")).toBeInTheDocument();
  });

  it("omitting onLog is safe when nothing is log-mode (Home's usage)", () => {
    const onComplete = vi.fn(async () => {});
    render(<TaskRowList items={[toggleItem({ id: "t1", title: "Fajr" })]} onComplete={onComplete} />);

    expect(screen.getByRole("button", { name: 'Mark "Fajr" done' })).toBeInTheDocument();
  });

  it("degrades a log-mode row to inert (no crash, console.error) when onLog was never provided", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onComplete = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <TaskRowList
        items={[logItem({ id: "f1", title: "Pull-ups", log: { kind: "count", unit: "reps", target: 30, current: 10 } })]}
        onComplete={onComplete}
      />
    );

    const row = screen.getByRole("button", { name: "Log Pull-ups" });
    expect(row).toBeDisabled();
    await user.click(row);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('item "f1"'));
    consoleError.mockRestore();
  });
});
