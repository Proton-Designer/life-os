import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KillList } from "../kill-list";

const toggleKillListItemMock = vi.fn();
vi.mock("@/app/(app)/business/actions", () => ({
  setKillListItem: vi.fn(),
  toggleKillListItem: (...args: unknown[]) => toggleKillListItemMock(...args),
}));

describe("KillList", () => {
  beforeEach(() => {
    toggleKillListItemMock.mockReset();
  });

  it("flips the toggle's visual state immediately, before toggleKillListItem resolves", async () => {
    toggleKillListItemMock.mockImplementation(() => new Promise<void>(() => {}));

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
});
