import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrayerRow } from "../prayer-row";

const markPrayerMock = vi.fn();
const toggleSunnahMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
  toggleSunnah: (...args: unknown[]) => toggleSunnahMock(...args),
}));

describe("PrayerRow", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
    toggleSunnahMock.mockReset();
  });

  it("shows the clicked status as active immediately, before markPrayer resolves, with the positive (on-time) color", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));

    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="pending" sunnahCompletions={[]} />);

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
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="qada" sunnahCompletions={[]} />);
    expect(screen.getByRole("button", { name: "Qada" }).querySelector("span")).toHaveClass(
      "text-accent-warning"
    );
  });

  it("colors an active missed status with the negative accent", () => {
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="missed" sunnahCompletions={[]} />);
    expect(screen.getByRole("button", { name: "Missed" }).querySelector("span")).toHaveClass(
      "text-destructive"
    );
  });

  it("shows an Upcoming indicator when the prayer's window hasn't opened yet", () => {
    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="upcoming" sunnahCompletions={[]} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("shows no Upcoming indicator once the window is open (pending) or resolved", () => {
    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="pending" sunnahCompletions={[]} />);
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
  });

  it("keeps all three fard buttons present and unchanged regardless of status, including upcoming", () => {
    render(<PrayerRow date="2026-08-11" prayerName="isha" label="Isha" status="upcoming" sunnahCompletions={[]} />);
    expect(screen.getByRole("button", { name: "On-time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qada" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Missed" })).toBeInTheDocument();
  });

  describe("sunnah disclosure", () => {
    it("renders a variable-length list — one item for Fajr, two for Dhuhr", () => {
      const { unmount } = render(
        <PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />
      );
      expect(screen.getByRole("button", { name: /sunnah for fajr/i })).toBeInTheDocument();
      unmount();

      render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
      expect(screen.getByText("0/2")).toBeInTheDocument();
    });

    it("is collapsed by default — sunnah items are not in the document", () => {
      render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
      expect(screen.queryByRole("button", { name: /before.*4 rak/i })).not.toBeInTheDocument();
    });

    it("shows a quiet completion hint on the collapsed row", () => {
      render(
        <PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={["before"]} />
      );
      expect(screen.getByText("1/2")).toBeInTheDocument();
    });

    it("expands on click, with real aria-expanded/aria-controls semantics, and reveals the sunnah items", async () => {
      render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
      const toggle = screen.getByRole("button", { name: /sunnah for dhuhr/i });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      const user = userEvent.setup();
      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const controlsId = toggle.getAttribute("aria-controls");
      expect(controlsId).toBeTruthy();
      expect(document.getElementById(controlsId!)).toBeInTheDocument();
      expect(screen.getByText(/before/i)).toBeInTheDocument();
      expect(screen.getByText(/after/i)).toBeInTheDocument();
    });

    it("does not disturb the fard buttons when expanding — they remain present with the same accessible names", async () => {
      render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /sunnah for dhuhr/i }));

      expect(screen.getByRole("button", { name: "On-time" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Qada" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Missed" })).toBeInTheDocument();
    });

    it("toggles a sunnah item optimistically via toggleSunnah", async () => {
      toggleSunnahMock.mockImplementation(() => new Promise(() => {}));
      render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /sunnah for fajr/i }));

      const sunnahItem = screen.getByRole("button", { name: /before.*2 rak/i });
      expect(sunnahItem).toHaveAttribute("aria-pressed", "false");

      await user.click(sunnahItem);

      expect(toggleSunnahMock).toHaveBeenCalledWith("2026-08-11", "fajr", "before");
      expect(sunnahItem).toHaveAttribute("aria-pressed", "true");
    });

    it("shows the mu'akkadah emphasis as a quiet label, not a score", async () => {
      render(<PrayerRow date="2026-08-11" prayerName="asr" label="Asr" status="pending" sunnahCompletions={[]} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /sunnah for asr/i }));
      expect(screen.getByText(/ghayr mu'akkadah/i)).toBeInTheDocument();
    });
  });
});
