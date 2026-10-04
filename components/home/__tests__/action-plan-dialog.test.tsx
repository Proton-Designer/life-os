import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "@/lib/distractions/types";

const updateTriggerMock = vi.fn();
const saveActionPlanMock = vi.fn();
const refreshDistractionViewsMock = vi.fn(async () => {});
vi.mock("@/app/(app)/distractions/actions", () => ({
  updateTrigger: (...args: unknown[]) => updateTriggerMock(...args),
  saveActionPlan: (...args: unknown[]) => saveActionPlanMock(...args),
  refreshDistractionViews: () => refreshDistractionViewsMock(),
}));

import { ActionPlanDialog } from "../action-plan-dialog";

function trigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: "t1",
    domain: "business",
    name: "Slack notifications",
    description: "Pinging every 5 minutes",
    totalCount: 5,
    todayCount: 0, // plan-editing tests below use triggers with no event today (only in "All plans")
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
    refreshDistractionViewsMock.mockClear();
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

  it("renders the one shared review (today's triggers) above the editable All plans list", () => {
    render(
      <ActionPlanDialog
        open
        onOpenChange={() => {}}
        triggers={[trigger({ id: "today", name: "Today trigger", todayCount: 2 }), trigger({ id: "old", name: "Old trigger" })]}
      />
    );
    expect(screen.getByTestId("review-item-card")).toHaveTextContent("Today trigger");
    expect(screen.getByTestId("all-plans")).toHaveTextContent("Old trigger");
  });

  it("shows a calm empty state rather than crashing when there is nothing today and no plans", () => {
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[]} />);
    expect(screen.getByText(/nothing to review/i)).toBeInTheDocument();
    expect(screen.queryByTestId("all-plans")).not.toBeInTheDocument();
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

  // PERF-4 review F1: saveActionPlan no longer revalidates "/" and "/review" inline, so the
  // dialog itself must schedule the deferred refresh or Home/review keep the old plan cached.
  it("schedules the deferred distraction refresh after saving an edited plan", async () => {
    const user = userEvent.setup();
    render(<ActionPlanDialog open onOpenChange={() => {}} triggers={[trigger()]} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const plan = screen.getByDisplayValue("Mute #general during Lock In");
    await user.clear(plan);
    await user.type(plan, "Turn off notifications entirely");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveActionPlanMock).toHaveBeenCalled());
    await waitFor(() => expect(refreshDistractionViewsMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
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
