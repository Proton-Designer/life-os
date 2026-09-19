import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelfMasteryStep } from "../self-mastery-step";

// ONB item 4: "Remember what you read" offered adding a book during
// onboarding. Books get added in-app, not during onboarding — remove the
// affordance entirely rather than leaving it present-but-disabled.
describe("SelfMasteryStep — no book-adding affordance in onboarding (ONB item 4)", () => {
  function noop() {}

  it("never renders an Add a book control — the affordance and its ingestion-availability gate are both gone, not just hidden", () => {
    render(<SelfMasteryStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={2} />);
    expect(screen.queryByTestId("selfmastery-add-book")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selfmastery-file-input")).not.toBeInTheDocument();
  });

  it("Continue is the only action, and it advances immediately with no upload/confirm phases", () => {
    render(<SelfMasteryStep onBack={noop} onNext={noop} progressTotal={5} progressIndex={2} />);
    expect(screen.getByTestId("selfmastery-continue")).toBeInTheDocument();
    expect(screen.queryByTestId("selfmastery-upload-confirm")).not.toBeInTheDocument();
  });
});
