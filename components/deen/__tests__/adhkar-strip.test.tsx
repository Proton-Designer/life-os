import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdhkarStrip } from "../adhkar-strip";

const toggleAdhkarMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  toggleAdhkar: (...args: unknown[]) => toggleAdhkarMock(...args),
}));

describe("AdhkarStrip", () => {
  beforeEach(() => {
    toggleAdhkarMock.mockReset();
  });

  it("flips the clicked period's visual state immediately, before toggleAdhkar resolves", async () => {
    toggleAdhkarMock.mockImplementation(() => new Promise<void>(() => {}));

    render(<AdhkarStrip date="2026-08-11" morningCompleted={false} eveningCompleted={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Morning adhkar" }));

    expect(screen.getByRole("button", { name: "Morning adhkar" })).toHaveClass("bg-accent-deen");
    expect(screen.getByRole("button", { name: "Evening adhkar" })).not.toHaveClass("bg-accent-deen");
  });
});
