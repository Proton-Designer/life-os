import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrayerRow } from "../prayer-row";

const markPrayerMock = vi.fn();
const toggleSunnahMock = vi.fn();
const unmarkPrayerMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  markPrayer: (...args: unknown[]) => markPrayerMock(...args),
  toggleSunnah: (...args: unknown[]) => toggleSunnahMock(...args),
  unmarkPrayer: (...args: unknown[]) => unmarkPrayerMock(...args),
}));

describe("PrayerRow", () => {
  beforeEach(() => {
    markPrayerMock.mockReset();
    toggleSunnahMock.mockReset();
    unmarkPrayerMock.mockReset();
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

  it("unmarks (deletes) a status when its already-active button is pressed again", async () => {
    unmarkPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="on_time" sunnahCompletions={[]} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "On-time" }));

    expect(unmarkPrayerMock).toHaveBeenCalledWith("2026-08-11", "fajr");
    expect(markPrayerMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "On-time" }).querySelector("span")).not.toHaveClass(
      "text-accent-business"
    );
  });

  it("marks (not unmarks) when a different status is pressed than the currently active one", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="on_time" sunnahCompletions={[]} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Qada" }));

    expect(markPrayerMock).toHaveBeenCalledWith("2026-08-11", "fajr", "qada");
    expect(unmarkPrayerMock).not.toHaveBeenCalled();
  });

  it("auto-expands the sunnah disclosure when marking On-time", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />);

    const toggle = screen.getByRole("button", { name: /sunnah for fajr/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "On-time" }));

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not auto-expand when marking Qada or Missed", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Missed" }));

    expect(screen.getByRole("button", { name: /sunnah for fajr/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking anywhere on the row bar (not just the chevron) toggles the sunnah disclosure", async () => {
    render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Dhuhr"));
    expect(screen.getByRole("button", { name: /sunnah for dhuhr/i })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByText("Dhuhr"));
    expect(screen.getByRole("button", { name: /sunnah for dhuhr/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking a fard status button does not also toggle the sunnah disclosure", async () => {
    markPrayerMock.mockImplementation(() => new Promise<void>(() => {}));
    render(<PrayerRow date="2026-08-11" prayerName="dhuhr" label="Dhuhr" status="pending" sunnahCompletions={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Qada" }));

    expect(screen.getByRole("button", { name: /sunnah for dhuhr/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("a 'None' option at the bottom of the expanded sunnah list collapses it", async () => {
    render(<PrayerRow date="2026-08-11" prayerName="fajr" label="Fajr" status="pending" sunnahCompletions={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sunnah for fajr/i }));

    const noneButton = screen.getByRole("button", { name: "None" });
    expect(noneButton).toBeInTheDocument();

    await user.click(noneButton);

    expect(screen.getByRole("button", { name: /sunnah for fajr/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "None" })).not.toBeInTheDocument();
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
