import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const { checkMock, uncheckMock } = vi.hoisted(() => ({ checkMock: vi.fn(), uncheckMock: vi.fn() }));
vi.mock("@/app/(app)/morning-routine/actions", () => ({
  checkMorningRoutineItem: checkMock,
  uncheckMorningRoutineItem: uncheckMock,
  archiveMorningRoutineItem: vi.fn(async () => ({ ok: true })),
  createMorningRoutineItem: vi.fn(async () => ({ ok: true })),
}));

import { MorningRoutineCard } from "../morning-routine-card";

const items = [
  { id: "a", label: "Water", checkedToday: false },
  { id: "b", label: "Stretch", checkedToday: false },
] as never;

describe("MorningRoutineCard — PERF-1 sweep", () => {
  beforeEach(() => {
    resetKeyedQueuesForTests();
    checkMock.mockReset();
    uncheckMock.mockReset();
  });

  it("ticking one item neither waits on the server nor disables any other control; the other item can be ticked immediately", async () => {
    let finishA!: () => void;
    checkMock.mockImplementation((id: string) =>
      id === "a" ? new Promise((res) => (finishA = () => res({ ok: true }))) : Promise.resolve({ ok: true })
    );
    const user = userEvent.setup();
    render(<MorningRoutineCard initialItems={items} />);

    await user.click(screen.getByRole("button", { name: "Water" }));
    // flipped at once (struck through) while the write is still in flight
    expect(screen.getByText("Water")).toHaveClass("line-through");
    for (const b of screen.getAllByRole("button")) expect(b).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Stretch" }));
    expect(checkMock).toHaveBeenCalledWith("b"); // not queued behind item a
    await act(async () => finishA());
  });

  it("a rejected write reverts only that item and shows its error", async () => {
    checkMock.mockImplementation(async (id: string) => (id === "a" ? { ok: false, message: "nope" } : { ok: true }));
    const user = userEvent.setup();
    render(<MorningRoutineCard initialItems={items} />);
    await user.click(screen.getByRole("button", { name: "Water" }));
    await user.click(screen.getByRole("button", { name: "Stretch" }));
    await waitFor(() => expect(screen.getByText("nope")).toBeInTheDocument());
    expect(screen.getByText("Water")).not.toHaveClass("line-through");
    expect(screen.getByText("Stretch")).toHaveClass("line-through");
  });
});
