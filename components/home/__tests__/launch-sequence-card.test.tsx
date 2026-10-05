import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setLaunchStepDone = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }));
const refreshLaunchViews = vi.fn(async () => {});
const archive = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }));
const create = vi.fn();
vi.mock("@/app/(app)/open/actions", () => ({ startDayAction: vi.fn(async () => {}), startDayAtAction: vi.fn(async () => ({ ok: true, alreadyStarted: false })) }));
const update = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }));
vi.mock("@/app/(app)/morning-routine/actions", () => ({
  setLaunchStepDone: (...a: unknown[]) => setLaunchStepDone(...a),
  refreshLaunchViews: () => refreshLaunchViews(),
  archiveMorningRoutineItem: (...a: unknown[]) => archive(...a),
  createMorningRoutineItem: (...a: unknown[]) => create(...a),
  updateLaunchStep: (...a: unknown[]) => update(...a),
}));

import { LaunchSequenceCard } from "../launch-sequence-card";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { resetDeferredRefreshForTests } from "@/lib/client/deferred-refresh";
import type { MorningRoutineChecklistItem } from "@/lib/morning-routine/actions-core";

const step = (over: Partial<MorningRoutineChecklistItem> = {}): MorningRoutineChecklistItem => ({
  id: "s1", label: "stretch", createdAt: "2026-10-01T00:00:00Z", ifCue: "I pour my coffee", fallbackText: "one shoulder roll", habitId: null, checkedToday: false, doneLast7: 3, ...over,
});
const habits = [{ id: "h1", identityStatement: "I am someone who moves" }];

describe("LaunchSequenceCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
    resetDeferredRefreshForTests();
  });

  it("shows 'When <cue>, I <step>', the 2-minute chip and 'x of last 7' (a count, not a streak)", () => {
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    expect(screen.getByText("When I pour my coffee, I stretch")).toBeInTheDocument();
    expect(screen.getByTestId("last-seven")).toHaveTextContent("3 of last 7");
    expect(screen.getByTestId("fallback-chip")).toHaveTextContent("one shoulder roll");
  });

  it("a tap flips at once and sends ONE absolute setLaunchStepDone(true); tapping a done step sends false", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(setLaunchStepDone).toHaveBeenCalledWith("s1", true));
    unmount();
    render(<LaunchSequenceCard items={[step({ checkedToday: true })]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(setLaunchStepDone).toHaveBeenLastCalledWith("s1", false));
  });

  it("a refused tick (e.g. the linked habit vote) reverts and shows the reason", async () => {
    setLaunchStepDone.mockResolvedValueOnce({ ok: false, message: "That habit is paused." });
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step({ habitId: "h1" })]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByRole("checkbox"));
    expect(await screen.findByRole("alert")).toHaveTextContent("paused");
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  // THE OLD CARD'S BUGS (never resyncs, midnight): state derived from props, so new props win.
  it("RESYNC: a new server render (new items, new local day) replaces what is shown", () => {
    const { rerender } = render(<LaunchSequenceCard items={[step({ checkedToday: true, doneLast7: 1 })]} today="2026-10-05" habits={habits} />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    // the next morning: same step, not ticked yet, 2 of last 7
    rerender(<LaunchSequenceCard items={[step({ checkedToday: false, doneLast7: 2 })]} today="2026-10-06" habits={habits} />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("last-seven")).toHaveTextContent("2 of last 7");
  });

  it("positive control: the OLD useState(initialItems) pattern shows stale data after the same re-render", () => {
    function OldStyle({ items }: { items: MorningRoutineChecklistItem[] }) {
      const [state] = useState(items);
      return <span data-testid="old">{state[0]!.checkedToday ? "ticked" : "open"}</span>;
    }
    const { rerender } = render(<OldStyle items={[step({ checkedToday: true })]} />);
    rerender(<OldStyle items={[step({ checkedToday: false })]} />);
    expect(screen.getByTestId("old")).toHaveTextContent("ticked"); // stale -- the bug the new card avoids
  });

  it("add a step with a cue, fallback and habit link: the row appears at once, the cap hides Add at 5", async () => {
    create.mockResolvedValue({ ok: true, item: { id: "n1", label: "journal", createdAt: "x", ifCue: "I sit down", fallbackText: null, habitId: "h1" } });
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByTestId("launch-edit-toggle"));
    await user.click(screen.getByTestId("launch-add"));
    const draft = screen.getByTestId("launch-draft");
    await user.type(within(draft).getByLabelText("When"), "I sit down");
    await user.type(within(draft).getByLabelText("I will"), "journal");
    await user.selectOptions(within(draft).getByLabelText("Counts toward habit"), "h1");
    await user.click(screen.getByTestId("launch-save"));
    expect(create).toHaveBeenCalledWith("journal", { ifCue: "I sit down", fallbackText: null, habitId: "h1" });
    expect(await screen.findByText("When I sit down, I journal")).toBeInTheDocument();
  });

  it("at 5 steps there is no Add button and a note says why (positive control: 4 steps still offers it)", async () => {
    const user = userEvent.setup();
    const five = Array.from({ length: 5 }, (_, i) => step({ id: `s${i}`, label: `step ${i}` }));
    const { unmount } = render(<LaunchSequenceCard items={five.slice(0, 4)} today="2026-10-05" habits={[]} />);
    await user.click(screen.getByTestId("launch-edit-toggle"));
    expect(screen.getByTestId("launch-add")).toBeInTheDocument();
    unmount();
    render(<LaunchSequenceCard items={five} today="2026-10-05" habits={[]} />);
    await user.click(screen.getByTestId("launch-edit-toggle"));
    expect(screen.queryByTestId("launch-add")).not.toBeInTheDocument();
    expect(screen.getByText(/most a sequence can hold/)).toBeInTheDocument();
  });

  it("edit saves in place; a failed edit shows the error and keeps the old text", async () => {
    update.mockResolvedValueOnce({ ok: false, message: "That step no longer exists." });
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByTestId("launch-edit-toggle"));
    await user.click(screen.getByRole("button", { name: "Edit stretch" }));
    const label = screen.getByLabelText("I will");
    await user.clear(label);
    await user.type(label, "yoga");
    await user.click(screen.getByTestId("launch-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    expect(screen.queryByText(/I yoga/)).not.toBeInTheDocument();
    await user.click(screen.getByTestId("launch-save"));
    expect(await screen.findByText("When I pour my coffee, I yoga")).toBeInTheDocument();
  });

  it("remove hides the step at once and puts it back if the write fails", async () => {
    archive.mockResolvedValueOnce({ ok: false, message: "nope" });
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    await user.click(screen.getByTestId("launch-edit-toggle"));
    await user.click(screen.getByRole("button", { name: "Remove stretch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByText("When I pour my coffee, I stretch")).toBeInTheDocument();
  });
});

describe("LaunchSequenceCard — offers to start the day (never forces it)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyedQueuesForTests();
    resetDeferredRefreshForTests();
  });

  it("before the day is started, ticking a step offers 'Start your day too' with the Start day button (and Woke earlier?)", async () => {
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} dayStarted={false} />);
    expect(screen.queryByTestId("launch-start-offer")).not.toBeInTheDocument(); // nothing until a tick
    await user.click(screen.getByRole("checkbox"));
    const offer = await screen.findByTestId("launch-start-offer");
    expect(within(offer).getByTestId("start-day")).toBeInTheDocument();
    expect(within(offer).getByTestId("woke-earlier")).toBeInTheDocument();
  });

  it("un-ticking does not offer it; once the day is started (the default) there is never an offer", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<LaunchSequenceCard items={[step({ checkedToday: true })]} today="2026-10-05" habits={habits} dayStarted={false} />);
    await user.click(screen.getByRole("checkbox")); // un-tick
    expect(screen.queryByTestId("launch-start-offer")).not.toBeInTheDocument();
    unmount();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />); // dayStarted defaults to true
    await user.click(screen.getByRole("checkbox"));
    expect(screen.queryByTestId("launch-start-offer")).not.toBeInTheDocument();
  });

  it("ticking alone never starts the day (a late catch-up tick must not record a wrong wake time)", async () => {
    const { startDayAction } = await import("@/app/(app)/open/actions");
    const user = userEvent.setup();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} dayStarted={false} />);
    await user.click(screen.getByRole("checkbox"));
    expect(startDayAction).not.toHaveBeenCalled();
  });
});


describe("LaunchSequenceCard — plan rehearsal", () => {
  it("shows yesterday's hardest trigger with its plan, above the steps", () => {
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} rehearsal={{ trigger: "Phone at my desk", domain: "business", body: "Phone goes in the drawer, then I start the timer", yesterdayCount: 3 }} />);
    const box = screen.getByTestId("launch-rehearsal");
    expect(box).toHaveTextContent("Yesterday “Phone at my desk” hit 3 times");
    expect(box).toHaveTextContent("Phone goes in the drawer, then I start the timer");
  });

  it("a clean yesterday says it is the most frequent one; no plan renders nothing", () => {
    const { unmount } = render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} rehearsal={{ trigger: "Email", domain: "business", body: "Close the tab", yesterdayCount: 0 }} />);
    expect(screen.getByTestId("launch-rehearsal")).toHaveTextContent("most frequent distraction");
    unmount();
    render(<LaunchSequenceCard items={[step()]} today="2026-10-05" habits={habits} />);
    expect(screen.queryByTestId("launch-rehearsal")).not.toBeInTheDocument();
  });
});
