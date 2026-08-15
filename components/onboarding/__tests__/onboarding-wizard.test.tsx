import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnboardingWizard } from "../onboarding-wizard";

describe("OnboardingWizard", () => {
  it("shows a step indicator and an icon chip on step 1", () => {
    render(<OnboardingWizard />);
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-card").querySelector("svg")).toBeInTheDocument();
  });

  it("wraps the step content in the app's card shell", () => {
    render(<OnboardingWizard />);
    const card = screen.getByTestId("onboarding-card");
    expect(card.className).toContain("rounded-2xl");
    expect(card.className).toContain("border");
  });
});
