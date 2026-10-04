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

const INITIAL: SettingsFormData = {
  displayName: "Ayman",
  prayerCalcMethod: "MWL",
  asrMadhab: "standard",
  location: { lat: null, lng: null, label: null, timezone: null },
  checkinWindowStart: "08:00",
  checkinWindowEnd: "22:00",
  pinLockEnabled: false,
};

// UX-04: Profile/Prayer/Check-ins/Location are four separate full-width
// cards in document order with nothing tying them together visually. A
// shared "Account" label above them is the lowest-risk way to read them as
// one group without merging Location's deliberately-separate atomic-save
// <Panel> (see that file's own comment) into the Profile/Prayer/Check-ins
// <form>.
describe("SettingsForm grouping (UX-04)", () => {
  it("shows one 'Account' label, appearing before Profile and before Security", () => {
    render(<SettingsForm initial={INITIAL} email="ayman@example.com" deenMode />);
    const labels = screen.getAllByText("Account");
    expect(labels).toHaveLength(1);

    const account = labels[0];
    const profile = screen.getByText("Profile");
    const security = screen.getByText("Security");
    // DOCUMENT_POSITION_FOLLOWING (4): account comes before profile, and
    // profile comes before security -- the group brackets exactly
    // Profile/Prayer/Check-ins/Location, not Security/Data too.
    expect(account.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(profile.compareDocumentPosition(security) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not change any section's own title", () => {
    render(<SettingsForm initial={INITIAL} email="ayman@example.com" deenMode />);
    for (const title of ["Profile", "Prayer", "Check-ins", "Location", "Security", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});

describe("SettingsForm Deen Mode gating", () => {
  beforeEach(() => updateProfile.mockClear());

  it("shows the Prayer panel and its fields when Deen Mode is ON", () => {
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode />);
    expect(screen.getByText("Prayer")).toBeInTheDocument();
    expect(screen.getByLabelText("Calculation method")).toBeInTheDocument();
    expect(screen.getByLabelText("Asr madhab")).toBeInTheDocument();
  });

  it("hides the Prayer panel and its fields when Deen Mode is OFF", () => {
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

  it("saving with Deen Mode OFF never sends prayer_calc_method / asr_madhab (stored values preserved)", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={INITIAL} email="a@b.c" deenMode={false} />);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(updateProfile).toHaveBeenCalledTimes(1);
    const payload = updateProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("prayer_calc_method");
    expect(payload).not.toHaveProperty("asr_madhab");
    expect(payload).toHaveProperty("display_name", "Ayman");
  });

  it("saving with Deen Mode ON still sends the prayer fields", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initial={{ ...INITIAL, prayerCalcMethod: "ISNA", asrMadhab: "hanafi" }} email="a@b.c" deenMode />);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ prayer_calc_method: "ISNA", asr_madhab: "hanafi" })
    );
  });
});
