import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloseAccountStage } from "../close-account-stage";

// The blocked-state branch renders CloseBlockerRewrite, a client component
// that calls useRouter() -- needs a router context this plain render()
// doesn't provide otherwise. Unrelated to GAP-02 itself.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// GAP-02 (ENG3's DAYCLOSE-DFT2 pass): Continue used to link to
// `/close?stage=reflect`, but EveningClosePage takes no searchParams at
// all -- that query string could never do anything, ever. Retargeted as a
// same-page jump to Reflect's own heading id.
describe("CloseAccountStage — Continue affordance (GAP-02)", () => {
  it("Continue is a same-page anchor to Reflect's heading, not a dead query-string link", () => {
    render(<CloseAccountStage blockers={[]} blockingItems={[]} reviewGroups={[]} />);
    const continueLink = screen.getByRole("link", { name: "Continue" });
    expect(continueLink).toHaveAttribute("href", "#close-reflect-heading");
  });

  it("Continue is absent, not disabled, while a blocker stands -- unchanged from before", () => {
    render(
      <CloseAccountStage
        blockers={[{ kind: "forced_rewrite", triggerId: "t1", triggerName: "Phone" }]}
        blockingItems={[]}
        reviewGroups={[]}
      />
    );
    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  });

  // IA-P1b: the Account stage is the home of the distraction-plan review.
  describe("distraction-plan review (IA-P1b)", () => {
    const group = [
      {
        domain: "school" as const,
        items: [
          {
            trigger: {
              id: "t9", domain: "school" as const, name: "Doomscrolling", description: null, totalCount: 1, todayCount: 2,
              lastOccurredAtIso: "2026-10-04T10:00:00Z", createdDate: "2026-10-04", currentPlan: null,
            },
            todayCount: 2,
            isNew: true,
          },
        ],
      },
    ];

    it("unblocked: today's triggers are reviewable right here, including a plan-less one", () => {
      render(<CloseAccountStage blockers={[]} blockingItems={[]} reviewGroups={group} />);
      expect(screen.getByTestId("distraction-plan-review")).toBeInTheDocument();
      expect(screen.getByTestId("review-item-card")).toHaveTextContent("Doomscrolling");
    });

    it("unblocked with no triggers today: no review block (control for the above)", () => {
      render(<CloseAccountStage blockers={[]} blockingItems={[]} reviewGroups={[]} />);
      expect(screen.queryByTestId("distraction-plan-review")).not.toBeInTheDocument();
    });

    it("blocked: only the forced rewrite shows -- the optional review waits until the gate clears", () => {
      render(
        <CloseAccountStage
          blockers={[{ kind: "forced_rewrite", triggerId: "t1", triggerName: "Phone" }]}
          blockingItems={[]}
          reviewGroups={group}
        />
      );
      expect(screen.queryByTestId("distraction-plan-review")).not.toBeInTheDocument();
    });
  });
});
