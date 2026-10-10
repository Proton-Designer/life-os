import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { EMPTY_PLAN_DRAFT, PlanLineDetails, planDraftSummary, type PlanLineDraft, type PlanWorkTabOption } from "../plan-line-details";

const TABS: PlanWorkTabOption[] = [
  { key: "acme", label: "Acme Co", kind: "business" },
  { key: "day-job", label: "Day Job", kind: "job" },
];

function Harness({ tabs = TABS, killList = true }: { tabs?: PlanWorkTabOption[]; killList?: boolean }) {
  const [draft, setDraft] = useState<PlanLineDraft>(EMPTY_PLAN_DRAFT);
  return (
    <>
      <PlanLineDetails id="l1" title="Ship it" draft={draft} onChange={setDraft} areas={["faith", "work", "school"]} killListAvailable={killList} workTabs={tabs} timezone="UTC" relativeToNow={false} />
      <output data-testid="draft">{JSON.stringify({ area: draft.area, subdomain: draft.subdomain, kill: draft.addToKillList })}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("draft").textContent ?? "{}");

describe("Work popup in the plan line details", () => {
  it("picking Work asks which Work area, listing the person's own tabs", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    const picker = screen.getByRole("dialog");
    expect(within(picker).getByText("Which Work area?")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: /Acme Co/ })).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: /Day Job/ })).toBeInTheDocument();
    expect(state().area).toBeNull(); // nothing chosen until a tab is
  });

  it("a Business tab makes a Business line with the Kill List preselected", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    await user.click(screen.getByRole("button", { name: /Acme Co/ }));
    expect(state()).toEqual({ area: "business", subdomain: "acme", kill: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-add-to-kill-list")).toBeChecked();
    expect(screen.getByRole("button", { name: "Work · Acme Co" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a job tab is a Work line that goes to the Backlog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    await user.click(screen.getByRole("button", { name: /Day Job/ }));
    expect(state()).toEqual({ area: "work", subdomain: "day-job", kill: false });
    expect(screen.getByText("Added to your Work Backlog.")).toBeInTheDocument();
  });

  it("choosing another domain clears the tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    await user.click(screen.getByRole("button", { name: /Acme Co/ }));
    await user.click(screen.getByRole("button", { name: "School" }));
    expect(state()).toEqual({ area: "school", subdomain: null, kill: false });
  });

  it("with no Work tabs, Work is a plain domain with no popup", async () => {
    const user = userEvent.setup();
    render(<Harness tabs={[]} />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state()).toEqual({ area: "work", subdomain: null, kill: false });
  });
});

describe("planDraftSummary with Work tabs", () => {
  it("names the tab", () => {
    expect(planDraftSummary({ ...EMPTY_PLAN_DRAFT, area: "business", subdomain: "acme", addToKillList: true }, TABS)).toEqual(["Work · Acme Co", "Kill List"]);
  });
  it("falls back to the domain name when the tab is gone", () => {
    expect(planDraftSummary({ ...EMPTY_PLAN_DRAFT, area: "work", subdomain: "archived" }, TABS)).toEqual(["Work"]);
  });
});
