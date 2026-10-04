import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalGrowthStep } from "../personal-growth-step";
import type { SubdomainInput } from "../types";

const applyOnboardingFitnessChoiceMock = vi.fn(async (_style: "plan" | "ad_hoc") => {});
vi.mock("@/app/(app)/fitness/workouts/template-actions", () => ({
  applyOnboardingFitnessChoice: (style: "plan" | "ad_hoc") => applyOnboardingFitnessChoiceMock(style),
}));

beforeEach(() => {
  applyOnboardingFitnessChoiceMock.mockClear();
});

// Deen Mode (R5): onboarding offers NO faith/religious option at all -- the
// Settings -> Deen Mode switch is the only way in. (Supersedes ONB item 3,
// which only un-preselected Faith.)
describe("PersonalGrowthStep — no Faith option (Deen Mode R5)", () => {
  function noop() {}

  it("offers only Fitness and Self-Mastery, both preselected, and no Faith card or copy", () => {
    render(<PersonalGrowthStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={1} />);
    expect(screen.queryByTestId("subdomain-option-faith")).not.toBeInTheDocument();
    expect(screen.queryByText(/faith|prayer|qur.an|deen/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("subdomain-option-self_mastery")).toHaveAttribute("aria-pressed", "true");
  });

  it("the walk never reaches a faith step and never submits a faith subdomain", async () => {
    const user = userEvent.setup();
    let result: SubdomainInput[] = [];
    render(<PersonalGrowthStep onBack={noop} onNext={(subs) => (result = subs)} progressTotal={5} progressIndex={1} />);
    await user.click(screen.getByTestId("onboarding-next"));
    await user.click(screen.getByTestId("selfmastery-continue"));
    expect(screen.queryByTestId("faith-location-input")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("fitness-style-plan"));
    expect(result.map((s) => s.key)).toEqual(["self_mastery", "fitness"]);
  });

  it("Fitness alone (Self-Mastery removed) still satisfies the one-minimum rule", async () => {
    const user = userEvent.setup();
    render(<PersonalGrowthStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={1} />);
    await user.click(screen.getByTestId("subdomain-option-self_mastery"));
    expect(screen.queryByTestId("subdomain-minimum-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("subdomain-option-fitness")).toHaveAttribute("aria-pressed", "true");
  });
});

// ONB item 6 follow-up (BRIEF-eng1-item6.md): the fitness style choice used
// to be written and never read. Finishing the walk with a chosen style must
// call the real fitness-starter effect with that exact style, without
// blocking the wizard's own advance to onNext.
describe("PersonalGrowthStep — fitness choice gets a real starting effect (ONB item 6 follow-up)", () => {
  function noop() {}

  it('picking "Follow a plan" applies the "plan" starter once the walk finishes', async () => {
    const user = userEvent.setup();
    let result: SubdomainInput[] = [];
    render(<PersonalGrowthStep onBack={noop} onNext={(subs) => (result = subs)} progressTotal={5} progressIndex={1} />);

    await user.click(screen.getByTestId("onboarding-next")); // select -> self_mastery
    await user.click(screen.getByTestId("selfmastery-continue")); // self_mastery -> fitness
    await user.click(screen.getByTestId("fitness-style-plan")); // fitness -> finish()

    expect(applyOnboardingFitnessChoiceMock).toHaveBeenCalledExactlyOnceWith("plan");
    expect(result.find((s) => s.key === "fitness")?.config).toEqual({ style: "plan" });
  });

  it('picking "Train ad hoc" applies the "ad_hoc" starter once the walk finishes', async () => {
    const user = userEvent.setup();
    render(<PersonalGrowthStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={1} />);

    await user.click(screen.getByTestId("onboarding-next"));
    await user.click(screen.getByTestId("selfmastery-continue"));
    await user.click(screen.getByTestId("fitness-style-adhoc"));

    expect(applyOnboardingFitnessChoiceMock).toHaveBeenCalledExactlyOnceWith("ad_hoc");
  });

  it("a failure applying the starter template never blocks or throws through onNext", async () => {
    applyOnboardingFitnessChoiceMock.mockRejectedValueOnce(new Error("db unavailable"));
    const user = userEvent.setup();
    let called = false;
    render(<PersonalGrowthStep onBack={noop} onNext={() => (called = true)} progressTotal={5} progressIndex={1} />);

    await user.click(screen.getByTestId("onboarding-next"));
    await user.click(screen.getByTestId("selfmastery-continue"));
    await user.click(screen.getByTestId("fitness-style-plan"));

    expect(called).toBe(true);
  });
});
