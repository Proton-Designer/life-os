import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...args: unknown[]) => updateProfile(...args) }));

import { FeatureVisibilitySettings } from "../feature-visibility-settings";

describe("FeatureVisibilitySettings", () => {
  beforeEach(() => {
    updateProfile.mockReset();
    updateProfile.mockImplementation(async () => {});
  });

  it("renders a checkbox per toggleable feature, all checked when nothing is hidden", () => {
    render(<FeatureVisibilitySettings initialHidden={[]} />);
    for (const label of ["Work", "Business", "School", "Fitness", "Insights"]) {
      expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    }
  });

  it("never shows a Home or Settings checkbox — the lockout guard", () => {
    render(<FeatureVisibilitySettings initialHidden={[]} />);
    expect(screen.queryByRole("checkbox", { name: /^Home$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Settings$/i })).not.toBeInTheDocument();
  });

  it("reflects initialHidden as unchecked", () => {
    render(<FeatureVisibilitySettings initialHidden={["business"]} />);
    expect(screen.getByRole("checkbox", { name: "Business" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Work" })).toBeChecked();
  });

  // Deen Mode (profiles.deen_mode) supersedes the "deen" hide entry: one switch, not two.
  it("does not list Faith; a stored 'deen' value is preserved on the next save", async () => {
    const user = userEvent.setup();
    render(<FeatureVisibilitySettings initialHidden={["deen"]} />);
    expect(screen.queryByRole("checkbox", { name: "Faith" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Business" }));

    expect(updateProfile).toHaveBeenCalledWith({ hidden_features: ["deen", "business"] });
  });

  it("unchecking a feature calls updateProfile with it added to hidden_features", async () => {
    const user = userEvent.setup();
    render(<FeatureVisibilitySettings initialHidden={[]} />);

    await user.click(screen.getByRole("checkbox", { name: "Business" }));

    expect(updateProfile).toHaveBeenCalledWith({ hidden_features: ["business"] });
  });

  it("re-checking a hidden feature calls updateProfile with it removed", async () => {
    const user = userEvent.setup();
    render(<FeatureVisibilitySettings initialHidden={["business", "school"]} />);

    await user.click(screen.getByRole("checkbox", { name: "Business" }));

    const call = updateProfile.mock.calls[0][0] as { hidden_features: string[] };
    expect(call.hidden_features).toEqual(["school"]);
  });

  it("reverts the optimistic toggle and shows an error if the save fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("Unknown feature id"));
    const user = userEvent.setup();
    render(<FeatureVisibilitySettings initialHidden={[]} />);

    await user.click(screen.getByRole("checkbox", { name: "Work" }));

    expect(await screen.findByText(/Unknown feature id/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Work" })).toBeChecked();
  });
});
