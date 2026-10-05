import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KillList } from "../kill-list";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";

const setCompletedMock = vi.fn();
vi.mock("@/app/(app)/business/actions", () => ({
  setKillListItem: vi.fn(),
  toggleKillListItem: vi.fn(),
  setKillListItemCompleted: (...args: unknown[]) => setCompletedMock(...args),
  refreshBusinessViews: vi.fn(async () => {}),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TWO_SLOTS: React.ComponentProps<typeof KillList>["slots"] = [
  { id: "slot-1", text: "First", completed: false },
  { id: "slot-2", text: "Second", completed: false },
  { id: null, text: "", completed: false },
];

describe("KillList", () => {
  beforeEach(() => {
    setCompletedMock.mockReset();
    resetKeyedQueuesForTests();
  });

  it("flips the toggle's visual state immediately, before setKillListItemCompleted resolves", async () => {
    setCompletedMock.mockImplementation(() => new Promise<void>(() => {}));

    render(
      <KillList
        date="2026-08-11"
        slots={[
          { id: "slot-1", text: "Ship the landing page", completed: false },
          { id: null, text: "", completed: false },
          { id: null, text: "", completed: false },
        ]}
      />
    );

    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", { name: "Mark complete" });
    await user.click(toggleButton);

    expect(screen.getByRole("button", { name: "Mark incomplete" })).toBeInTheDocument();
    expect(screen.getByText("Ship the landing page")).toHaveClass("line-through");
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("does not show the Done badge on an incomplete item", () => {
    render(
      <KillList
        date="2026-08-11"
        slots={[
          { id: "slot-1", text: "Ship the landing page", completed: false },
          { id: null, text: "", completed: false },
          { id: null, text: "", completed: false },
        ]}
      />
    );
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("shows no empty-state framing text when all three slots are unused", () => {
    render(
      <KillList
        date="2026-08-11"
        slots={[
          { id: null, text: "", completed: false },
          { id: null, text: "", completed: false },
          { id: null, text: "", completed: false },
        ]}
      />
    );
    expect(screen.queryByText(/whatever else/i)).not.toBeInTheDocument();
  });

  // PERF-2 invariants: nothing else disabled while one slot saves, same-slot taps are
  // stored in tap order as ABSOLUTE values, errors revert only the failing slot.
  it("a slot saving does not disable the other slot, and rapid taps on one slot send true then false in order", async () => {
    const first = deferred();
    setCompletedMock.mockImplementationOnce(() => first.promise).mockImplementation(async () => {});
    render(<KillList date="2026-08-11" slots={TWO_SLOTS} />);
    const user = userEvent.setup();
    const [firstBtn, secondBtn] = screen.getAllByRole("button", { name: "Mark complete" });

    await user.click(firstBtn); // in flight
    expect(secondBtn).not.toBeDisabled();
    await user.click(screen.getAllByRole("button", { name: "Mark incomplete" })[0]); // queued: false
    expect(setCompletedMock).toHaveBeenCalledTimes(1);
    expect(setCompletedMock).toHaveBeenNthCalledWith(1, "slot-1", true);

    await user.click(secondBtn); // independent slot goes out immediately
    expect(setCompletedMock).toHaveBeenNthCalledWith(2, "slot-2", true);

    await act(async () => first.resolve());
    await waitFor(() => expect(setCompletedMock).toHaveBeenNthCalledWith(3, "slot-1", false));
  });

  it("a failed write reverts ONLY that slot", async () => {
    setCompletedMock.mockImplementation(async (id: string) => {
      if (id === "slot-1") throw new Error("boom");
    });
    render(<KillList date="2026-08-11" slots={TWO_SLOTS} />);
    const user = userEvent.setup();
    const [firstBtn, secondBtn] = screen.getAllByRole("button", { name: "Mark complete" });
    await user.click(firstBtn);
    await user.click(secondBtn);
    await waitFor(() => expect(screen.getByText("Not saved")).toBeInTheDocument());
    // slot-1 reverted, slot-2 stays done
    expect(screen.getAllByRole("button", { name: "Mark complete" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Mark incomplete" })).toHaveLength(1);
  });
});

describe("KillList: two slots plus a dimmed optional third", () => {
  const OPTIONAL_EMPTY: React.ComponentProps<typeof KillList>["slots"] = [
    { id: "s1", text: "First", completed: false },
    { id: "s2", text: "Second", completed: false },
    { id: null, text: "", completed: false },
  ];

  it("the empty third slot is a dimmed 'Optional' placeholder, not an open editor; the two required ones are real rows", () => {
    render(<KillList date="2026-10-05" slots={OPTIONAL_EMPTY} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    const optional = screen.getByTestId("kill-list-optional");
    expect(optional).toHaveClass("opacity-50");
    expect(optional).toHaveTextContent(/optional/i);
    expect(screen.queryByPlaceholderText(/priority 3/i)).not.toBeInTheDocument();
  });

  it("an empty REQUIRED slot still opens straight into its editor (positive control: the same shape as the optional one, but it edits)", () => {
    render(<KillList date="2026-10-05" slots={[{ id: "s1", text: "First", completed: false }, { id: null, text: "", completed: false }, { id: null, text: "", completed: false }]} />);
    expect(screen.getByPlaceholderText("Priority 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("kill-list-optional")).toHaveLength(1);
  });

  it("clicking the placeholder opens the editor for the third item", async () => {
    const user = userEvent.setup();
    render(<KillList date="2026-10-05" slots={OPTIONAL_EMPTY} />);
    await user.click(screen.getByTestId("kill-list-optional").querySelector("button")!);
    expect(await screen.findByPlaceholderText(/priority 3 \(optional\)/i)).toBeInTheDocument();
  });

  it("a filled third slot renders as a normal row labelled Optional", () => {
    render(<KillList date="2026-10-05" slots={[OPTIONAL_EMPTY[0], OPTIONAL_EMPTY[1], { id: "s3", text: "Stretch task", completed: false }]} />);
    expect(screen.getByText("Stretch task")).toBeInTheDocument();
    expect(screen.queryByTestId("kill-list-optional")).not.toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });
});
