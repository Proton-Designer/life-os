import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...a: unknown[]) => updateProfile(...a) }));

import { TimezoneSettings } from "../timezone-settings";

describe("TimezoneSettings", () => {
  beforeEach(() => {
    updateProfile.mockReset();
    updateProfile.mockImplementation(async () => {});
  });

  it("shows the stored timezone and saves a change as { timezone } only", async () => {
    const user = userEvent.setup();
    render(<TimezoneSettings initial="America/Chicago" />);
    const select = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(select.value).toBe("America/Chicago");
    await user.selectOptions(select, "America/New_York");
    expect(updateProfile).toHaveBeenCalledWith({ timezone: "America/New_York" });
  });

  it("rolls back and shows the error if the save fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    render(<TimezoneSettings initial="America/Chicago" />);
    await user.selectOptions(screen.getByLabelText("Timezone"), "America/New_York");
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect((screen.getByLabelText("Timezone") as HTMLSelectElement).value).toBe("America/Chicago");
  });
});
