import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...a: unknown[]) => updateProfile(...a) }));
vi.mock("@/app/(app)/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/components/settings/location-settings", () => ({ LocationSettings: () => <div data-testid="location-settings" /> }));
vi.mock("@/components/settings/timezone-settings", () => ({ TimezoneSettings: () => <div data-testid="timezone-settings" /> }));
vi.mock("@/components/settings/delete-account-section", () => ({ DeleteAccountSection: () => null }));

import { SettingsForm, type SettingsFormData } from "../settings-form";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";

const INITIAL: SettingsFormData = {
  displayName: "Ayman",
  prayerCalcMethod: "MWL",
  asrMadhab: "standard",
  location: { lat: null, lng: null, label: null, timezone: null },
  checkinWindowStart: "08:00",
  checkinWindowEnd: "22:00",
  allocationCheckinsEnabled: false,
  pinLockEnabled: false,
};

// UX-04: Profile/Prayer/Check-ins/Location are four separate full-width
// cards in document order with nothing tying them together visually. A
// shared "Account" label above them is the lowest-risk way to read them as
// one group without merging Location's deliberately-separate atomic-save
// <Panel> (see that file's own comment) into the Profile/Prayer/Check-ins
// <form>.
describe("SettingsForm section order (matches the left tabs)", () => {
  const slots = {
    afterProfile: (
      <>
        <section id="appearance" />
        <section id="features" />
      </>
    ),
    afterCheckins: (
      <>
        <section id="notifications" />
        <section id="reading" />
        <section id="ai" />
        <section id="canvas" />
        <section id="rescuetime" />
        <section id="whoop" />
        <section id="connectors" />
        <section id="webhooks" />
      </>
    ),
  };
  // Ids of the section panels, in DOCUMENT order.
  const sectionIds = (container: HTMLElement) => {
    const known = new Set<string>(SETTINGS_SECTIONS.map((x) => x.id));
    return [...container.querySelectorAll("[id]")].map((el) => el.id).filter((id) => known.has(id));
  };

  it("Faith ON: panels render in exactly the tab order", () => {
    const { container } = render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode slots={slots} />);
    const expected = SETTINGS_SECTIONS.map((x) => x.id).filter((id) => id !== "timezone");
    expect(sectionIds(container)).toEqual(expected);
  });

  it("Faith OFF: Prayer and Location are gone, Timezone takes Location's place, order unchanged", () => {
    const { container } = render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode={false} slots={slots} />);
    const expected = SETTINGS_SECTIONS.map((x) => x.id).filter((id) => id !== "prayer" && id !== "location");
    expect(sectionIds(container)).toEqual(expected);
  });

  it("Profile, Prayer and Check-ins still save together through the one main form even though they are no longer contiguous", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode slots={slots} />);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: INITIAL.displayName, prayer_calc_method: INITIAL.prayerCalcMethod, checkin_window_start: INITIAL.checkinWindowStart })
    );
  });

  it("no <form> is nested inside another (slot panels carry their own forms)", () => {
    const { container } = render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode slots={{ afterProfile: <form data-testid="slot-form" /> }} />);
    for (const f of container.querySelectorAll("form")) expect(f.parentElement?.closest("form")).toBeNull();
  });

  it("does not change any section's own title", () => {
    render(<SettingsForm initial={INITIAL} email="ayman@example.com" deenMode />);
    for (const title of ["Profile", "Prayer", "Check-ins", "Location", "Security", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});

describe("SettingsForm 2-hour check-in switch", () => {
  beforeEach(() => updateProfile.mockClear());

  it("reflects the stored value (off by default) and turning it on saves immediately", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode />);
    const sw = screen.getByRole("switch", { name: "Check in every 2 hours" });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    expect(updateProfile).toHaveBeenCalledWith({ allocation_checkins_enabled: true });
    expect(sw).toBeChecked();
  });

  it("shows it on when the account has it on, and turning it off saves false", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={{ ...INITIAL, allocationCheckinsEnabled: true }} email="a@b.c" deenMode />);
    const sw = screen.getByRole("switch", { name: "Check in every 2 hours" });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(updateProfile).toHaveBeenCalledWith({ allocation_checkins_enabled: false });
  });
});

describe("SettingsForm Faith Mode gating", () => {
  beforeEach(() => updateProfile.mockClear());

  it("shows the Prayer panel and its fields when Faith Mode is ON", () => {
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode />);
    expect(screen.getByText("Prayer")).toBeInTheDocument();
    expect(screen.getByLabelText("Calculation method")).toBeInTheDocument();
    expect(screen.getByLabelText("Asr madhab")).toBeInTheDocument();
  });

  it("hides the Prayer panel and its fields when Faith Mode is OFF", () => {
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode={false} />);
    expect(screen.queryByText("Prayer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Calculation method")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Asr madhab")).not.toBeInTheDocument();
  });

  it("OFF swaps the Location panel for a Timezone panel; ON shows Location only", () => {
    const off = render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode={false} />);
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
    expect(screen.queryByTestId("location-settings")).not.toBeInTheDocument();
    expect(screen.getByText("Timezone")).toBeInTheDocument();
    expect(screen.getByTestId("timezone-settings")).toBeInTheDocument();
    off.unmount();
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode />);
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.queryByTestId("timezone-settings")).not.toBeInTheDocument();
  });

  it("saving with Faith Mode OFF never sends prayer_calc_method / asr_madhab (stored values preserved)", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode={false} />);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(updateProfile).toHaveBeenCalledTimes(1);
    const payload = updateProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("prayer_calc_method");
    expect(payload).not.toHaveProperty("asr_madhab");
    expect(payload).toHaveProperty("display_name", "Ayman");
  });

  it("saving with Faith Mode ON still sends the prayer fields", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={{ ...INITIAL, prayerCalcMethod: "ISNA", asrMadhab: "hanafi" }} email="a@b.c" deenMode />);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ prayer_calc_method: "ISNA", asr_madhab: "hanafi" })
    );
  });
});
