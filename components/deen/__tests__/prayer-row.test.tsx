import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrayerRow } from "../prayer-row";

const markPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
}));

describe("PrayerRow", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
  });

  it("shows the clicked status as active immediately, before markPrayer resolves", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));

    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="pending" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "On-time" }));

    expect(screen.getByRole("button", { name: "On-time" })).toHaveClass("bg-accent-deen");
    expect(screen.getByRole("button", { name: "Qada" })).not.toHaveClass("bg-accent-deen");
  });
});
