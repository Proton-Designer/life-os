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

  it("shows the clicked status as active immediately, before markPrayer resolves, with the positive (on-time) color", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));

    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="pending" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "On-time" }));

    expect(screen.getByRole("button", { name: "On-time" }).querySelector("span")).toHaveClass(
      "text-accent-business"
    );
    expect(screen.getByRole("button", { name: "Qada" }).querySelector("span")).not.toHaveClass(
      "text-accent-business"
    );
  });

  it("colors an active qada status with the warning accent, distinct from on-time", () => {
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="qada" />);
    expect(screen.getByRole("button", { name: "Qada" }).querySelector("span")).toHaveClass(
      "text-accent-warning"
    );
  });

  it("colors an active missed status with the negative accent", () => {
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="missed" />);
    expect(screen.getByRole("button", { name: "Missed" }).querySelector("span")).toHaveClass(
      "text-destructive"
    );
  });
});
