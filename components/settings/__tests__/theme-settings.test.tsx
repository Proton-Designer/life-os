import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...args: unknown[]) => updateProfile(...args) }));

import { ThemeSettings } from "../theme-settings";

describe("ThemeSettings", () => {
  beforeEach(() => {
    updateProfile.mockReset();
    updateProfile.mockImplementation(async () => {});
  });

  it("renders all 5 presets, marking the initial one Current", () => {
    render(<ThemeSettings initial="oxblood" />);
    for (const label of ["Oxblood", "Ocean", "Forest", "Sunset", "Mono"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Oxblood/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Ocean/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("picking a preset calls updateProfile with theme_preset and flips the pressed state", async () => {
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);

    await user.click(screen.getByRole("button", { name: /Ocean/ }));

    expect(updateProfile).toHaveBeenCalledWith({ theme_preset: "ocean" });
    expect(screen.getByRole("button", { name: /Ocean/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Oxblood/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the already-selected preset does not call updateProfile again", async () => {
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);
    await user.click(screen.getByRole("button", { name: /Oxblood/ }));
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("reverts the optimistic selection and shows an error if the save fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("Unknown theme_preset"));
    const user = userEvent.setup();
    render(<ThemeSettings initial="oxblood" />);

    await user.click(screen.getByRole("button", { name: /Forest/ }));

    expect(await screen.findByText(/Unknown theme_preset/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Oxblood/ })).toHaveAttribute("aria-pressed", "true");
  });
});
