import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { OptionCard } from "../option-card";
import { Dumbbell } from "lucide-react";

// VERIFICATION (not a fix): ac21642 claims `justPressed` is deliberately NOT
// set when the card is already selected, "otherwise DEselecting a toggle
// would keep it looking selected." Testing the TOGGLE use case exactly as
// personal-growth-step.tsx uses it: the parent owns `selected` and flips it
// synchronously on click.
function ToggleHarness() {
  const [selected, setSelected] = useState(false);
  return (
    <OptionCard
      testId="verify-toggle"
      icon={Dumbbell}
      accent="fitness"
      label="Toggle me"
      selected={selected}
      onToggle={() => setSelected((s) => !s)}
    />
  );
}

describe("OptionCard justPressed — verifying ac21642's deselect claim", () => {
  it("visually deselects immediately after a SECOND click on an already-selected toggle card", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);
    const card = screen.getByTestId("verify-toggle");

    expect(card).not.toHaveAttribute("data-pressed", "true");

    await user.click(card); // select
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveAttribute("data-pressed", "true");

    await user.click(card); // deselect
    expect(card).toHaveAttribute("aria-pressed", "false");
    // This is the exact property ac21642 claims to preserve.
    expect(card).not.toHaveAttribute("data-pressed", "true");
  });

  it("re-selects cleanly after a deselect, so the flag is cleared rather than stuck off", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);
    const card = screen.getByTestId("verify-toggle");

    await user.click(card); // select
    await user.click(card); // deselect
    await user.click(card); // select again

    // The obvious wrong fix for the deselect bug is to stop setting the flag
    // at all, which passes the test above and silently removes the feedback
    // this whole change exists to add. A third click catches that.
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveAttribute("data-pressed", "true");
  });

  it("keeps a NAVIGATION-TRIGGER card lit, because its parent never flips `selected`", async () => {
    const user = userEvent.setup();
    // Exactly how fitness-step.tsx and school-step.tsx use this: `selected` is
    // hardcoded false and the click advances the wizard instead of toggling.
    // The deselect fix clears `justPressed` when `selected` CHANGES — here it
    // never changes, so the press must stay visible for the whole transition.
    // Without this test, a future fix could clear the flag unconditionally and
    // silently restore the original "nothing happens when I press it" bug.
    render(
      <OptionCard
        testId="verify-nav"
        icon={Dumbbell}
        accent="fitness"
        label="Advance"
        selected={false}
        onToggle={() => {}}
      />
    );
    const card = screen.getByTestId("verify-nav");

    expect(card).not.toHaveAttribute("data-pressed", "true");
    await user.click(card);

    expect(card).toHaveAttribute("data-pressed", "true");
    // aria-pressed must still tell the truth: nothing is actually selected.
    expect(card).toHaveAttribute("aria-pressed", "false");
  });
});
