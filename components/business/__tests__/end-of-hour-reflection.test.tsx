import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const listMyReflectionCardsMock = vi.fn();
const startEndOfHourRitualMock = vi.fn();
const submitEndOfHourReflectionMock = vi.fn();
vi.mock("@/app/(app)/personal/reflection-cards-actions", () => ({
  listMyReflectionCards: (...args: unknown[]) => listMyReflectionCardsMock(...args),
  startEndOfHourRitual: (...args: unknown[]) => startEndOfHourRitualMock(...args),
  submitEndOfHourReflection: (...args: unknown[]) => submitEndOfHourReflectionMock(...args),
}));

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
    listMyReflectionCardsMock.mockReset();
    startEndOfHourRitualMock.mockReset();
    submitEndOfHourReflectionMock.mockReset();
  });

  it("renders nothing before the hour is up, and never even fetches cards", () => {
    render(<EndOfHourReflection elapsedMinutes={30} intervals={INTERVALS} />);
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
    expect(listMyReflectionCardsMock).not.toHaveBeenCalled();
  });

  // listMyReflectionCards() itself returns [] both when cards_library is
  // off AND when it's on with zero cards saved yet -- same UI outcome
  // either way (nothing to reflect on right now), so this one scenario
  // covers both real-world causes.
  it("renders nothing once the hour is up if there are no cards to show", async () => {
    listMyReflectionCardsMock.mockResolvedValue([]);
    render(<EndOfHourReflection elapsedMinutes={65} intervals={INTERVALS} />);
    await waitFor(() => expect(listMyReflectionCardsMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Reflect" })).not.toBeInTheDocument();
  });

  it("shows a Reflect trigger once the hour is up and at least one card exists", async () => {
    listMyReflectionCardsMock.mockResolvedValue([CARD]);
    render(<EndOfHourReflection elapsedMinutes={61} intervals={INTERVALS} />);
    expect(await screen.findByRole("button", { name: "Reflect" })).toBeInTheDocument();
  });

  it("opening the ritual fetches the recap + next card, and submitting logs it", async () => {
    listMyReflectionCardsMock.mockResolvedValue([CARD]);
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
    listMyReflectionCardsMock.mockResolvedValue([CARD]);
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
