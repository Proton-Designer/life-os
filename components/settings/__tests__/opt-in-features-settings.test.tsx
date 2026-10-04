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

  it("renders a checkbox for cards_library, all unchecked when nothing is enabled", () => {
    render(<OptInFeaturesSettings initialEnabled={[]} />);
    expect(screen.getByRole("checkbox", { name: /Cards library/ })).not.toBeChecked();
  });

  // estimate_vs_actual (P3-11) has zero domain logic behind it -- rendering
  // a toggle for it would be a lie (settings/actions.ts:57's own "not yet
  // built"). Suppressed at the render layer only -- see
  // opt-in-features-settings.tsx's own header comment on why the id itself
  // stays in OPT_IN_FEATURE_IDS regardless.
  it("does not render a toggle for estimate_vs_actual -- it isn't built yet", () => {
    render(<OptInFeaturesSettings initialEnabled={[]} />);
    expect(screen.queryByRole("checkbox", { name: /Estimate vs\. actual/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Estimate vs\. actual/)).not.toBeInTheDocument();
  });

  // RS-01: both start OFF for every account and are offered here.
  it("offers Morning routine and Sleep plan, unchecked by default", () => {
    render(<OptInFeaturesSettings initialEnabled={[]} />);
    expect(screen.getByRole("checkbox", { name: /Morning routine/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Sleep plan/ })).not.toBeChecked();
  });

  it("reflects initialEnabled as checked", () => {
    render(<OptInFeaturesSettings initialEnabled={["cards_library"]} />);
    expect(screen.getByRole("checkbox", { name: /Cards library/ })).toBeChecked();
  });

  it("checking a feature calls updateProfile with it added to enabled_features", async () => {
    const user = userEvent.setup();
    render(<OptInFeaturesSettings initialEnabled={[]} />);

    await user.click(screen.getByRole("checkbox", { name: /Cards library/ }));

    expect(updateProfile).toHaveBeenCalledWith({ enabled_features: ["cards_library"] });
  });

  it("unchecking an enabled feature calls updateProfile with it removed", async () => {
    const user = userEvent.setup();
    render(<OptInFeaturesSettings initialEnabled={["cards_library"]} />);

    await user.click(screen.getByRole("checkbox", { name: /Cards library/ }));

    const call = updateProfile.mock.calls[0]![0] as { enabled_features: string[] };
    expect(call.enabled_features).toEqual([]);
  });

  // A row with a stored-but-unrendered estimate_vs_actual (set before this
  // suppression, or written directly) must not have that value silently
  // dropped just because toggling an unrelated, rendered feature re-sends
  // the whole array -- suppression is a render-layer decision, not a data
  // migration.
  it("preserves an already-stored, unrendered estimate_vs_actual when toggling cards_library", async () => {
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
