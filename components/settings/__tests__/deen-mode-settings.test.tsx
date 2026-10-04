import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...a: unknown[]) => updateProfile(...a) }));

import { DeenModeSettings } from "../deen-mode-settings";

describe("DeenModeSettings", () => {
  beforeEach(() => {
    updateProfile.mockReset();
    updateProfile.mockImplementation(async () => {});
  });

  it("reflects initialOn", () => {
    const { unmount } = render(<DeenModeSettings initialOn={false} />);
    expect(screen.getByRole("switch", { name: "Deen Mode" })).not.toBeChecked();
    unmount();
    render(<DeenModeSettings initialOn />);
    expect(screen.getByRole("switch", { name: "Deen Mode" })).toBeChecked();
  });

  it("turning on / off writes only { deen_mode }", async () => {
    const user = userEvent.setup();
    render(<DeenModeSettings initialOn={false} />);
    await user.click(screen.getByRole("switch", { name: "Deen Mode" }));
    expect(updateProfile).toHaveBeenLastCalledWith({ deen_mode: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Deen Mode" })).not.toBeDisabled());
    await user.click(screen.getByRole("switch", { name: "Deen Mode" }));
    expect(updateProfile).toHaveBeenLastCalledWith({ deen_mode: false });
  });

  it("rolls back and shows the error when the save fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    render(<DeenModeSettings initialOn={false} />);
    await user.click(screen.getByRole("switch", { name: "Deen Mode" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Deen Mode" })).not.toBeChecked();
  });
});
