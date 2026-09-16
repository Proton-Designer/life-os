import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/settings/actions", () => ({ updateProfile: (...args: unknown[]) => updateProfile(...args) }));

import { OptInFeaturesSettings } from "../opt-in-features-settings";

describe("OptInFeaturesSettings", () => {
  beforeEach(() => {
    updateProfile.mockReset();
    updateProfile.mockImplementation(async () => {});
  });

  it("renders a checkbox per opt-in feature, all unchecked when nothing is enabled", () => {
    render(<OptInFeaturesSettings initialEnabled={[]} />);
    expect(screen.getByRole("checkbox", { name: /Cards library/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Estimate vs\. actual/ })).not.toBeChecked();
  });

  it("reflects initialEnabled as checked", () => {
    render(<OptInFeaturesSettings initialEnabled={["cards_library"]} />);
    expect(screen.getByRole("checkbox", { name: /Cards library/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Estimate vs\. actual/ })).not.toBeChecked();
  });

  it("checking a feature calls updateProfile with it added to enabled_features", async () => {
    const user = userEvent.setup();
    render(<OptInFeaturesSettings initialEnabled={[]} />);

    await user.click(screen.getByRole("checkbox", { name: /Cards library/ }));

    expect(updateProfile).toHaveBeenCalledWith({ enabled_features: ["cards_library"] });
  });

  it("unchecking an enabled feature calls updateProfile with it removed", async () => {
    const user = userEvent.setup();
    render(<OptInFeaturesSettings initialEnabled={["cards_library", "estimate_vs_actual"]} />);

    await user.click(screen.getByRole("checkbox", { name: /Cards library/ }));

    const call = updateProfile.mock.calls[0]![0] as { enabled_features: string[] };
    expect(call.enabled_features).toEqual(["estimate_vs_actual"]);
  });

  it("reverts the optimistic toggle and shows an error if the save fails", async () => {
    updateProfile.mockRejectedValueOnce(new Error("Unknown feature id"));
    const user = userEvent.setup();
    render(<OptInFeaturesSettings initialEnabled={[]} />);

    await user.click(screen.getByRole("checkbox", { name: /Cards library/ }));

    expect(await screen.findByText(/Unknown feature id/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Cards library/ })).not.toBeChecked();
  });
});
