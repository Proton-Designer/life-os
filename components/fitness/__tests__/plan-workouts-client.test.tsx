import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PlanWorkoutsClient } from "../workouts/plan-workouts-client";
import type { ExerciseOption } from "../exercise-picker";
import type { PlanDraft } from "@/lib/fitness/plan-types";

const exercises: ExerciseOption[] = [{ id: "ex-1", name: "Pull-ups", primaryMuscles: ["back_lats"], secondaryMuscles: [] }];

const microPlan: PlanDraft = {
  kind: "micro",
  id: "plan-1",
  name: "Starter",
  exercises: [
    {
      id: "me-1",
      exerciseId: "ex-1",
      name: "Pull-ups",
      scheduleDays: [1, 2, 3, 4, 5],
      goalType: "daily_total",
      goalValue: 30,
      notes: null,
    },
  ],
};

function setup(overrides: Partial<Parameters<typeof PlanWorkoutsClient>[0]> = {}) {
  const savePlan = vi.fn().mockResolvedValue({ id: "new-plan" });
  const deletePlan = vi.fn().mockResolvedValue(undefined);
  const activatePlan = vi.fn().mockResolvedValue(undefined);
  const deactivateSlot = vi.fn().mockResolvedValue(undefined);
  const createPlanFromTemplate = vi.fn().mockResolvedValue({ id: "template-plan" });
  render(
    <PlanWorkoutsClient
      initialPlans={[microPlan]}
      initialActivePlans={{ microPlanId: null, routinePlanId: null }}
      allExercises={exercises}
      onCreateExercise={vi.fn()}
      savePlan={savePlan}
      deletePlan={deletePlan}
      activatePlan={activatePlan}
      deactivateSlot={deactivateSlot}
      createPlanFromTemplate={createPlanFromTemplate}
      {...overrides}
    />
  );
  return { savePlan, deletePlan, activatePlan, deactivateSlot, createPlanFromTemplate };
}

describe("PlanWorkoutsClient", () => {
  it("shows 'none selected' for both slots when nothing is active", () => {
    setup();
    expect(screen.getByTestId("active-slot-micro").textContent).toContain("none selected");
    expect(screen.getByTestId("active-slot-routine").textContent).toContain("none selected");
  });

  it("activating a plan calls activatePlan and updates the active slot", async () => {
    const user = userEvent.setup();
    const { activatePlan } = setup();
    await user.click(screen.getByRole("button", { name: "Activate" }));
    expect(activatePlan).toHaveBeenCalledWith("plan-1", "micro");
    expect(screen.getByTestId("active-slot-micro").textContent).toContain("Starter");
  });

  it("previewing a plan does NOT call activatePlan, and labels the calendar as a preview", async () => {
    const user = userEvent.setup();
    const { activatePlan } = setup();
    await user.click(screen.getByText("Starter"));
    expect(activatePlan).not.toHaveBeenCalled();
    expect(screen.getByText("Previewing (not activated)")).toBeInTheDocument();
  });

  it("deleting the active plan warns it's the active plan, then clears the slot on confirm", async () => {
    const user = userEvent.setup();
    const { deletePlan } = setup({ initialActivePlans: { microPlanId: "plan-1", routinePlanId: null } });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("This is your active plan. Delete anyway?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deletePlan).toHaveBeenCalledWith("plan-1");
    expect(screen.getByTestId("active-slot-micro").textContent).toContain("none selected");
  });

  it("creating a new micro workout end-to-end calls savePlan with a full draft and returns to the list", async () => {
    const user = userEvent.setup();
    const { savePlan } = setup({ initialPlans: [] });
    await user.click(screen.getByRole("button", { name: "+ Create workout" }));
    await user.click(screen.getByRole("button", { name: "Create from scratch" }));
    await user.type(screen.getByLabelText("New workout name"), "Second plan");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Micro/ }));

    await user.type(screen.getByLabelText("Search exercises"), "Pull");
    await user.click(screen.getByRole("button", { name: "Pull-ups" }));
    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(savePlan).toHaveBeenCalledWith(expect.objectContaining({ kind: "micro", name: "Second plan" }));
    expect(screen.getByTestId("plan-list")).toBeInTheDocument();
  });

  it("starting from a template calls createPlanFromTemplate with the chosen key and returns to the list", async () => {
    const user = userEvent.setup();
    const { createPlanFromTemplate } = setup();
    await user.click(screen.getByRole("button", { name: "+ Create workout" }));
    await user.click(screen.getByRole("button", { name: "Start from a template" }));
    await user.click(screen.getByRole("button", { name: /Starter Reps/ }));

    expect(createPlanFromTemplate).toHaveBeenCalledWith("starter_reps");
    expect(await screen.findByTestId("plan-list")).toBeInTheDocument();
  });
});
