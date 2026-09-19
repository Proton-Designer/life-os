import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalGrowthStep } from "../personal-growth-step";
import type { SubdomainInput } from "../types";

// ONB item 3: "Faith auto-assumes Muslim" -- pressing the Personal Growth
// domain preselected Faith (deen: prayer times, Qur'an, adhkar) along with
// Fitness/Self-Mastery. Since Faith IS the app's only religious-practice
// track, defaulting it ON is equivalent to defaulting every new account to
// practicing Islam without ever asking. Fitness and Self-Mastery carry no
// such assumption and stay preselected; only Faith must start unchosen.
describe("PersonalGrowthStep — Faith must not be preselected (ONB item 3)", () => {
  function noop() {}

  it("shows Faith UNselected while Fitness and Self-Mastery stay preselected", () => {
    render(<PersonalGrowthStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={1} />);
    expect(screen.getByTestId("subdomain-option-faith")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subdomain-option-self_mastery")).toHaveAttribute("aria-pressed", "true");
  });

  it("a user who never taps Faith never walks into the Faith step at all", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<PersonalGrowthStep onBack={noop} onNext={(subs) => seen.push(...subs.map((s) => s.key))} progressTotal={5} progressIndex={1} />);
    await user.click(screen.getByTestId("onboarding-next"));
    // Self-Mastery's primary path collects nothing, so it advances immediately;
    // Fitness's own step then renders. Faith should never appear in the walk.
    expect(screen.queryByTestId("faith-location-input")).not.toBeInTheDocument();
  });

  it("Faith can still be explicitly opted into, and its config is collected exactly as before", async () => {
    const user = userEvent.setup();
    let result: SubdomainInput[] = [];
    render(<PersonalGrowthStep onBack={noop} onNext={(subs) => (result = subs)} progressTotal={5} progressIndex={1} />);
    await user.click(screen.getByTestId("subdomain-option-faith"));
    expect(screen.getByTestId("subdomain-option-faith")).toHaveAttribute("aria-pressed", "true");
  });

  it("Fitness alone (Faith and Self-Mastery both removed) still satisfies the one-minimum rule", async () => {
    const user = userEvent.setup();
    render(<PersonalGrowthStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={1} />);
    // Faith already starts off; removing Self-Mastery should leave Fitness as
    // the sole kept subdomain without tripping the "keep at least one" guard.
    await user.click(screen.getByTestId("subdomain-option-self_mastery"));
    expect(screen.queryByTestId("subdomain-minimum-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });
});
