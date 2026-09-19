import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FitnessStep } from "../fitness-step";

// ONB item 6: (a) pressing an option must show instant visual feedback;
// (b) the transition to the next screen must not wait on a server round-trip
// (RC-A, fixed upstream in option-card.tsx/onboarding-wizard.tsx — nothing
// in this file participates in that await chain, so there is nothing here
// to change for it); (c) onboarding must not ask the user to set up their
// full training plan — this file has never rendered such a flow: it is
// already exactly the two-option choice the plan's assumption asks for,
// with the choice's `config` written once and never read by anything
// downstream (confirmed by grep: no consumer of FitnessConfig.style exists
// outside these three onboarding files).
describe("FitnessStep (ONB item 6)", () => {
  it("(a) shows the pressed option as visually selected the instant it's clicked, synchronously — no server round-trip needed to render it", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<FitnessStep onBack={() => {}} onNext={onNext} progressTotal={5} progressIndex={3} />);
    const planOption = screen.getByTestId("fitness-style-plan");
    expect(planOption).not.toHaveAttribute("data-pressed", "true");
    await user.click(planOption);
    // option-card.tsx's justPressed sets this synchronously on click, before
    // onNext's caller ever resolves anything async — this is the RC-A fix
    // for a NAVIGATION-TRIGGER card (selected is always false here; the
    // instant feedback comes from data-pressed, not aria-pressed).
    expect(planOption).toHaveAttribute("data-pressed", "true");
  });

  it("(a) the same instant feedback applies to the ad-hoc option", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<FitnessStep onBack={() => {}} onNext={onNext} progressTotal={5} progressIndex={3} />);
    const adhocOption = screen.getByTestId("fitness-style-adhoc");
    await user.click(adhocOption);
    expect(adhocOption).toHaveAttribute("data-pressed", "true");
  });

  it("(c) is ALREADY only the two-option choice — picking either calls onNext immediately with just {style}, no in-onboarding plan-builder screen ever renders", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<FitnessStep onBack={() => {}} onNext={onNext} progressTotal={5} progressIndex={3} />);
    await user.click(screen.getByTestId("fitness-style-plan"));
    expect(onNext).toHaveBeenCalledWith({ style: "plan" });
    expect(onNext).toHaveBeenCalledTimes(1);
    // No schedule/session/rep-target setup UI exists anywhere in this component.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("ad hoc reports {style: 'ad_hoc'} the same way", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<FitnessStep onBack={() => {}} onNext={onNext} progressTotal={5} progressIndex={3} />);
    await user.click(screen.getByTestId("fitness-style-adhoc"));
    expect(onNext).toHaveBeenCalledWith({ style: "ad_hoc" });
  });
});
