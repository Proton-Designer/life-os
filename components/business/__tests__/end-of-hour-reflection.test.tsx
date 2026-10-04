import { configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryStateMock = vi.fn();
const startEndOfHourRitualMock = vi.fn();
const submitEndOfHourReflectionMock = vi.fn();
vi.mock("@/app/(app)/personal/reflection-cards-actions", () => ({
  getEndOfHourEntryState: (...args: unknown[]) => entryStateMock(...args),
  startEndOfHourRitual: (...args: unknown[]) => startEndOfHourRitualMock(...args),
  submitEndOfHourReflection: (...args: unknown[]) => submitEndOfHourReflectionMock(...args),
}));

// Deflake: these flows cross several async boundaries (mocked action -> state -> Radix dialog mount ->
// second mocked action -> render), and testing-library's default 1 s findBy/waitFor budget is shorter than
// the wall-clock a full-suite run can take under CPU contention (the "no card" test failed in a loaded full
// suite and passed 7/7 alone). Nothing here asserts on timing, so a generous ceiling only changes WHEN a
// real failure is reported, never whether a pass is possible; the happy path still resolves immediately.
configure({ asyncUtilTimeout: 8_000 });
vi.setConfig({ testTimeout: 20_000 });

const NUDGE = "Add a reflection card in Settings to unlock the End-of-Hour ritual.";

import { EndOfHourReflection } from "../end-of-hour-reflection";

const INTERVALS = [{ domain: "deep_work", minutes: 60, isDistraction: false }];
const CARD = {
  id: "c1",
  userId: "u1",
  kind: "goal" as const,
  content: "Finish the draft.",
  active: true,
  lastShownAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
};

describe("EndOfHourReflection", () => {
  beforeEach(() => {
    entryStateMock.mockReset();
    startEndOfHourRitualMock.mockReset();
    submitEndOfHourReflectionMock.mockReset();
  });

  it("renders nothing before the hour is up, and never even fetches state", () => {
    render(<EndOfHourReflection elapsedMinutes={30} intervals={INTERVALS} />);
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
    expect(screen.queryByText(NUDGE)).not.toBeInTheDocument();
    expect(entryStateMock).not.toHaveBeenCalled();
  });

  // GAP-06: the previous version of this suite asserted that "flag off" and
  // "flag on, zero cards" were one scenario because listMyReflectionCards()
  // returned [] for both. That conflation was fine while the empty branch
  // rendered NOTHING. It stopped being fine the moment the branch says
  // something: a first-run nudge shown to a user who never enabled the
  // feature is advertising, on a banner every user sees. These are now two
  // distinct tests because they are two distinct populations.
  it("renders nothing once the hour is up when the cards_library flag is OFF", async () => {
    entryStateMock.mockResolvedValue({ enabled: false, hasCards: false });
    render(<EndOfHourReflection elapsedMinutes={65} intervals={INTERVALS} />);
    await waitFor(() => expect(entryStateMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
    expect(screen.queryByText(NUDGE)).not.toBeInTheDocument();
  });

  it("explains the prerequisite when the flag is ON but the account has zero cards", async () => {
    entryStateMock.mockResolvedValue({ enabled: true, hasCards: false });
    render(<EndOfHourReflection elapsedMinutes={65} intervals={INTERVALS} />);
    expect(await screen.findByText(NUDGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
  });

  it("renders nothing if the state fetch fails, rather than guessing", async () => {
    entryStateMock.mockRejectedValue(new Error("network"));
    render(<EndOfHourReflection elapsedMinutes={65} intervals={INTERVALS} />);
    await waitFor(() => expect(entryStateMock).toHaveBeenCalled());
    expect(screen.queryByText(NUDGE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
  });

  it("shows a Reflect trigger once the hour is up and at least one card exists", async () => {
    entryStateMock.mockResolvedValue({ enabled: true, hasCards: true });
    render(<EndOfHourReflection elapsedMinutes={61} intervals={INTERVALS} />);
    expect(await screen.findByRole("button", { name: "Reflect" })).toBeInTheDocument();
    expect(screen.queryByText(NUDGE)).not.toBeInTheDocument();
  });

  it("opening the ritual fetches the recap + next card, and submitting logs it", async () => {
    entryStateMock.mockResolvedValue({ enabled: true, hasCards: true });
    startEndOfHourRitualMock.mockResolvedValue({
      ok: true,
      message: "Ready.",
      recap: { totalMinutes: 60, workMinutes: 45, distractionCount: 1, byDomain: { deep_work: 45 } },
      card: CARD,
    });
    submitEndOfHourReflectionMock.mockResolvedValue({ ok: true, message: "Logged." });

    const user = userEvent.setup();
    render(<EndOfHourReflection elapsedMinutes={61} intervals={INTERVALS} />);

    await user.click(await screen.findByRole("button", { name: "Reflect" }));
    expect(startEndOfHourRitualMock).toHaveBeenCalledWith(INTERVALS);
    expect(await screen.findByText(/45 of 60 minutes/)).toBeInTheDocument();
    expect(await screen.findByText("Finish the draft.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Log it/ }));
    expect(submitEndOfHourReflectionMock).toHaveBeenCalledWith("c1", null);
    expect(await screen.findByText("Logged. Back to it.")).toBeInTheDocument();
  });

  // A realistic race: the trigger became visible off an earlier
  // listMyReflectionCards() snapshot that had at least one card, but by the
  // time the ritual actually opens (a fresh fetch via startEndOfHourRitual)
  // that card was archived elsewhere in the meantime -- the dialog itself
  // must still degrade honestly rather than assume `card` is always set.
  it("when the ritual comes back with no card, says so and disables submit", async () => {
    entryStateMock.mockResolvedValue({ enabled: true, hasCards: true });
    startEndOfHourRitualMock.mockResolvedValue({
      ok: true,
      message: "Ready.",
      recap: { totalMinutes: 60, workMinutes: 60, distractionCount: 0, byDomain: {} },
      card: null,
    });

    const user = userEvent.setup();
    render(<EndOfHourReflection elapsedMinutes={61} intervals={INTERVALS} />);
    await user.click(await screen.findByRole("button", { name: "Reflect" }));

    expect(await screen.findByText(/no cards/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log it/ })).toBeDisabled();
  });
});
