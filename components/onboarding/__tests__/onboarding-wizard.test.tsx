import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingWizard } from "../onboarding-wizard";

vi.mock("@/app/(app)/onboarding/actions", () => ({
  saveDomainSelection: vi.fn().mockResolvedValue(undefined),
  saveSubdomains: vi.fn().mockResolvedValue(undefined),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
}));

describe("OnboardingWizard", () => {
  it("shows the domain picker first, with a progress indicator", () => {
    render(<OnboardingWizard />);
    expect(screen.getByTestId("onboarding-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "domains");
    expect(screen.getByTestId("onboarding-progress")).toBeInTheDocument();
    expect(screen.getByTestId("domain-option-personal_growth")).toHaveAttribute("aria-pressed", "false");
  });

  it("requires at least one domain before continuing", () => {
    render(<OnboardingWizard />);
    expect(screen.getByTestId("onboarding-next")).toBeDisabled();
  });

  // Ayman, 2026-09-19: "When Faith is pressed it automatically assumes Muslim."
  // Selecting Personal Growth must not decide a user's religion for them, so
  // faith starts OFF while the two non-confessional subdomains stay ON. The
  // assertion is deliberately three-way rather than just faith=false: the
  // failure we care about is faith flipping back on, but the failure we'd
  // MISS with a narrower test is someone "fixing" this by defaulting
  // everything off, which would quietly change a different screen's behaviour.
  it("walks into Personal Growth with faith NOT preselected, the other two on", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("onboarding-next"));

    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-subdomains");
    expect(screen.getByTestId("subdomain-option-faith")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("subdomain-option-self_mastery")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a user opt INTO faith deliberately", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("onboarding-next"));

    // Not preselected is the requirement; unreachable would be a new bug.
    await user.click(screen.getByTestId("subdomain-option-faith"));
    expect(screen.getByTestId("subdomain-option-faith")).toHaveAttribute("aria-pressed", "true");
  });

  // ONB item 5 (Ayman): "when the back arrow is pressed during onboarding it
  // sends the user back to the 'What's part of Personal …' screen, not the
  // screen directly before they were."
  //
  // Each step already handled its own INTERNAL back. The fault was cross-domain:
  // leaving a domain unmounted its step, so returning re-mounted it fresh at its
  // first screen — which is literally the "What's part of Personal Growth?"
  // screen. The regression this locks is subtle: every step-level back test
  // passes either way, because none of them ever leaves the domain and comes
  // back. Only a cross-domain round trip can see it.
  it("returns to the screen you were actually on when walking back into a domain", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("domain-option-work"));
    await user.click(screen.getByTestId("onboarding-next"));

    // Walk Personal Growth to its end: subdomains -> self_mastery -> fitness.
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-subdomains");
    await user.click(screen.getByTestId("onboarding-next"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-self_mastery");
    await user.click(screen.getByTestId("selfmastery-continue"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-fitness");

    // Choosing a fitness style finishes the domain and moves the walk to Work.
    await user.click(screen.getByTestId("fitness-style-adhoc"));
    expect(await screen.findByTestId("onboarding-step")).toHaveAttribute("data-step", "work-list");

    // Back from Work's FIRST screen crosses the domain boundary. It must land
    // on the fitness screen we actually left, not Personal Growth's opener.
    await user.click(screen.getByTestId("onboarding-back"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-fitness");
    expect(screen.getByTestId("onboarding-step")).not.toHaveAttribute("data-step", "personal_growth-subdomains");
  });

  it("refuses to remove the last remaining subdomain", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("onboarding-next"));

    // Faith is off by default now, so the walk down to one starts from two:
    // remove self_mastery, leaving fitness, then try to remove fitness too.
    await user.click(screen.getByTestId("subdomain-option-self_mastery"));
    await user.click(screen.getByTestId("subdomain-option-fitness"));

    expect(screen.getByTestId("subdomain-minimum-warning")).toBeInTheDocument();
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });
});
