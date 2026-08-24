import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "@/lib/distractions/types";

const updateTriggerMock = vi.fn();
const saveActionPlanMock = vi.fn();
vi.mock("@/app/(app)/distractions/actions", () => ({
  updateTrigger: (...args: unknown[]) => updateTriggerMock(...args),
  saveActionPlan: (...args: unknown[]) => saveActionPlanMock(...args),
}));

import { ActionPlanDialog } from "../action-plan-dialog";

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "t1",
    domain: "business",
    name: "Slack notifications",
    description: "Pinging every 5 minutes",
    totalCount: 5,
    todayCount: 2,
    lastOccurredAtIso: "2026-08-17T20:00:00Z",
    createdDate: "2026-08-10",
    currentPlan: {
      id: "p1",
      body: "Mute #general during Lock In",
      version: 1,
      createdAtIso: "2026-08-10T00:00:00Z",
      followedCount: 0,
      skippedCount: 0,
      mustRewrite: false,
    },
    ...overrides,
  };
}

describe("ActionPlanDialog", () => {
  beforeEach(() => {
    updateTriggerMock.mockReset();
    saveActionPlanMock.mockReset();
  });

  it("orders triggers most-recent-first via rankTriggersForPlanList", () => {
    render(
      <ActionPlanDialog
        open
        onOpenChange={() => {}}
        triggers={[
          trigger({ id: "old", name: "Older trigger", lastOccurredAtIso: "2026-08-10T08:00:00Z" }),
          trigger({ id: "new", name: "Newer trigger", lastOccurredAtIso: "2026-08-17T08:00:00Z" }),
        ]}
      />
    );
    const names = screen.getAllByText(/trigger$/).map((el) => el.textContent);
    expect(names).toEqual(["Newer trigger", "Older trigger"]);
  });

  it("shows an empty message rather than crashing when nothing has a plan yet", () => {
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[trigger({ currentPlan: null })]} />);
    expect(screen.getByText(/no triggers with a plan yet/i)).toBeInTheDocument();
  });

  it("edits a trigger's name, description, and plan body, saving both via updateTrigger and saveActionPlan", async () => {
    const user = userEvent.setup();
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[trigger()]} />);

    await user.click(screen.getByRole("button", { name: /edit slack notifications/i }));

    const nameInput = screen.getByDisplayValue("Slack notifications");
    await user.clear(nameInput);
    await user.type(nameInput, "Slack pings");

    const planTextarea = screen.getByDisplayValue("Mute #general during Lock In");
    await user.clear(planTextarea);
    await user.type(planTextarea, "Turn off notifications entirely");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTriggerMock).toHaveBeenCalledWith("t1", { name: "Slack pings" });
    expect(saveActionPlanMock).toHaveBeenCalledWith("t1", "Turn off notifications entirely");
    expect(screen.getByText("Slack pings")).toBeInTheDocument();
    expect(screen.getByText("Turn off notifications entirely")).toBeInTheDocument();
  });

  it("cancel restores the original values without saving", async () => {
    const user = userEvent.setup();
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[trigger()]} />);

    await user.click(screen.getByRole("button", { name: /edit slack notifications/i }));
    const nameInput = screen.getByDisplayValue("Slack notifications");
    await user.clear(nameInput);
    await user.type(nameInput, "Should not save");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateTriggerMock).not.toHaveBeenCalled();
    expect(screen.getByText("Slack notifications")).toBeInTheDocument();
    expect(screen.queryByText("Should not save")).not.toBeInTheDocument();
  });

  it("disables Save when the plan body is cleared to empty", async () => {
    const user = userEvent.setup();
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[trigger()]} />);

    await user.click(screen.getByRole("button", { name: /edit slack notifications/i }));
    const planTextarea = screen.getByDisplayValue("Mute #general during Lock In");
    await user.clear(planTextarea);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
