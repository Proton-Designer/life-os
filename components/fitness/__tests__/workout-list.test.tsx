import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkoutList, type WorkoutSummary, type SeedPlan } from "../workout-list";

const WORKOUTS: WorkoutSummary[] = [
  { id: "w1", name: "Push A", exerciseCount: 3 },
  { id: "w2", name: "Pull A", exerciseCount: 4 },
];

const PLANS: SeedPlan[] = [{ id: "p1", name: "Rotating Upper", description: "Every session touches push/pull/delts." }];

function renderList(overrides: Partial<React.ComponentProps<typeof WorkoutList>> = {}) {
  const onCreateNew = vi.fn();
  const onAdoptPlan = vi.fn().mockResolvedValue(undefined);
  const onQuickLog = vi.fn();
  const onEdit = vi.fn();
  const onDuplicate = vi.fn().mockResolvedValue({ id: "w-new" });
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <WorkoutList
      workouts={[]}
      onCreateNew={onCreateNew}
      onAdoptPlan={onAdoptPlan}
      onQuickLog={onQuickLog}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onRename={onRename}
      onArchive={onArchive}
      {...overrides}
    />
  );
  return { ...utils, onCreateNew, onAdoptPlan, onQuickLog, onEdit, onDuplicate, onRename, onArchive };
}

describe("WorkoutList empty state (spec §4.1 first run)", () => {
  it("shows both equal-weight entry points and the tertiary quick-log link", () => {
    renderList({ seedPlans: PLANS });
    expect(screen.getByText("Create your own workout")).toBeInTheDocument();
    expect(screen.getByText("Start from one of these")).toBeInTheDocument();
    expect(screen.getByText("Rotating Upper")).toBeInTheDocument();
    expect(screen.getByText("or just log something now")).toBeInTheDocument();
  });

  it("still shows the create-your-own entry when no seed plans are available yet", () => {
    renderList({ seedPlans: [] });
    expect(screen.getByText("Create your own workout")).toBeInTheDocument();
    expect(screen.queryByText("Start from one of these")).not.toBeInTheDocument();
  });

  it("tapping create-your-own calls onCreateNew", async () => {
    const user = userEvent.setup();
    const { onCreateNew } = renderList();
    await user.click(screen.getByText("Create your own workout"));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it("tapping a plan card calls onAdoptPlan with its id", async () => {
    const user = userEvent.setup();
    const { onAdoptPlan } = renderList({ seedPlans: PLANS });
    await user.click(screen.getByText("Rotating Upper"));
    expect(onAdoptPlan).toHaveBeenCalledWith("p1");
  });
});

describe("WorkoutList populated state", () => {
  it("renders each workout with its exercise count", () => {
    renderList({ workouts: WORKOUTS });
    expect(screen.getByText("Push A")).toBeInTheDocument();
    expect(screen.getByText("3 exercises")).toBeInTheDocument();
    expect(screen.getByText("Pull A")).toBeInTheDocument();
  });

  it("tapping the workout name calls onEdit with its id", async () => {
    const user = userEvent.setup();
    const { onEdit } = renderList({ workouts: WORKOUTS });
    await user.click(screen.getByText("Push A"));
    expect(onEdit).toHaveBeenCalledWith("w1");
  });

  it("Duplicate calls onDuplicate with the workout id", async () => {
    const user = userEvent.setup();
    const { onDuplicate } = renderList({ workouts: WORKOUTS });
    await user.click(screen.getAllByRole("button", { name: "Duplicate" })[0]);
    expect(onDuplicate).toHaveBeenCalledWith("w1");
  });

  it("Archive calls onArchive with the workout id — never a delete affordance", async () => {
    const user = userEvent.setup();
    const { onArchive } = renderList({ workouts: WORKOUTS });
    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);
    expect(onArchive).toHaveBeenCalledWith("w1");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("Rename swaps in an editable name field and Save commits the new name", async () => {
    const user = userEvent.setup();
    const { onRename } = renderList({ workouts: WORKOUTS });
    await user.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const input = screen.getByLabelText("Rename Push A");
    await user.clear(input);
    await user.type(input, "Push A v2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenCalledWith("w1", "Push A v2");
  });

  it("a plain + New workout affordance is always available alongside the list", async () => {
    const user = userEvent.setup();
    const { onCreateNew } = renderList({ workouts: WORKOUTS });
    await user.click(screen.getByText("+ New workout"));
    expect(onCreateNew).toHaveBeenCalled();
  });
});
