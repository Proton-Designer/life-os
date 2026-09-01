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

  it("walks into Personal Growth with all three subdomains preselected", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("onboarding-next"));

    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "personal_growth-subdomains");
    expect(screen.getByTestId("subdomain-option-faith")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subdomain-option-self_mastery")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });

  it("refuses to remove the last remaining subdomain", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId("domain-option-personal_growth"));
    await user.click(screen.getByTestId("onboarding-next"));

    await user.click(screen.getByTestId("subdomain-option-faith"));
    await user.click(screen.getByTestId("subdomain-option-self_mastery"));
    // Two removed, one (fitness) left — try to remove the last one too.
    await user.click(screen.getByTestId("subdomain-option-fitness"));

    expect(screen.getByTestId("subdomain-minimum-warning")).toBeInTheDocument();
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });
});
