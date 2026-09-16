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
    render(<CloseAccountStage blockers={[]} blockingItems={[]} unplannedTodayCount={0} />);
    const continueLink = screen.getByRole("link", { name: "Continue" });
    expect(continueLink).toHaveAttribute("href", "#close-reflect-heading");
  });

  it("Continue is absent, not disabled, while a blocker stands -- unchanged from before", () => {
    render(
      <CloseAccountStage
        blockers={[{ kind: "forced_rewrite", triggerId: "t1", triggerName: "Phone" }]}
        blockingItems={[]}
        unplannedTodayCount={0}
      />
    );
    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  });
});
