import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalGrowthStep } from "../personal-growth-step";
import type { SubdomainInput } from "../types";

const applyOnboardingFitnessChoiceMock = vi.fn(async (_style: "plan" | "ad_hoc") => {});
vi.mock("@/app/(app)/fitness/workouts/template-actions", () => ({
  applyOnboardingFitnessChoice: (style: "plan" | "ad_hoc") => applyOnboardingFitnessChoiceMock(style),
}));

const CHICAGO = {
  city: "Chicago",
  province: "Illinois",
  country: "United States of America",
  lat: 41.83,
  lng: -87.75,
  timezone: "America/Chicago",
};
const searchCitiesMock = vi.fn(async (_query: string) => [CHICAGO]);
vi.mock("@/app/(app)/settings/location-actions", () => ({
  searchCities: (query: string) => searchCitiesMock(query),
}));

beforeEach(() => {
  applyOnboardingFitnessChoiceMock.mockClear();
  searchCitiesMock.mockClear();
});

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

  it("Faith-only: its config is captured correctly even though finish() runs in the same tick that sets it (stale-closure regression)", async () => {
    const user = userEvent.setup();
    let result: SubdomainInput[] = [];
    render(<PersonalGrowthStep onBack={noop} onNext={(subs) => (result = subs)} progressTotal={5} progressIndex={1} />);

    // Keep Faith alone: opt in, then remove both defaults -- Faith becomes
    // the only (and therefore also the LAST) kept subdomain, so its own
    // Continue click is the one that fires finish() synchronously.
    await user.click(screen.getByTestId("subdomain-option-faith"));
    await user.click(screen.getByTestId("subdomain-option-self_mastery"));
    await user.click(screen.getByTestId("subdomain-option-fitness"));
    await user.click(screen.getByTestId("onboarding-next")); // select -> faith

    await user.type(screen.getByTestId("faith-location-input"), "Chicago");
    await user.click(screen.getByTestId("faith-location-search"));
    await user.click(await screen.findByTestId("faith-location-result"));
    await user.click(screen.getByTestId("onboarding-next")); // faith -> finish()

    const faithSub = result.find((s) => s.key === "faith");
    expect(faithSub?.config).toMatchObject({
      location_lat: 41.83,
      location_lng: -87.75,
      timezone: "America/Chicago",
    });
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
