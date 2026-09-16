import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/components/settings/location-settings", () => ({ LocationSettings: () => null }));
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
    render(<SettingsForm initial={INITIAL} email="ayman@example.com" />);
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
    render(<SettingsForm initial={INITIAL} email="ayman@example.com" />);
    for (const title of ["Profile", "Prayer", "Check-ins", "Location", "Security", "Data"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});
