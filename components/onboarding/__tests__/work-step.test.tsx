import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkStep } from "../work-step";
import type { WorkSubdomainDraft } from "../types";

// ONB item 7: reorder (kind before name), rename (Job -> Position), and an
// "Add Later" escape hatch from the forced minimum-one-subdomain rule.
// ONB item 8b: the widget-picker sub-step is gone (Ayman ruled it inert --
// see known-issues.md T-0002) -- naming a subdomain now finalizes the draft
// directly, no intermediate "what should this screen show?" screen.
describe("WorkStep — ONB item 7", () => {
  function noop() {}

  it("asks position-or-business FIRST, before the name field ever appears", async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "work-kind");
    expect(screen.queryByTestId("work-subdomain-name")).not.toBeInTheDocument();
  });

  it("the name field appears only after a kind is chosen, not before", async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "work-name");
    expect(screen.getByTestId("work-subdomain-name")).toBeInTheDocument();
  });

  it("Back from the name screen returns to kind, not to the list", async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    await user.click(screen.getByTestId("onboarding-back"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "work-kind");
  });

  it("naming a subdomain and hitting Continue goes straight to the list -- no widget-picker sub-step", async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    await user.type(screen.getByTestId("work-subdomain-name"), "Acme Inc");
    await user.click(screen.getByTestId("onboarding-next"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "work-list");
    expect(screen.queryByTestId("widget-picker")).not.toBeInTheDocument();
    expect(screen.queryByText("What should this screen show?")).not.toBeInTheDocument();
  });

  it('shows "Position", not "Job", as the kind label and testId', async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    expect(screen.getByTestId("work-kind-position")).toBeInTheDocument();
    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.queryByText("Job")).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-kind-job")).not.toBeInTheDocument();
  });

  it('a saved draft displays "Position" (not the raw "job" value) in the list', async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    await user.type(screen.getByTestId("work-subdomain-name"), "Acme Inc");
    await user.click(screen.getByTestId("onboarding-next"));
    expect(screen.getByTestId("onboarding-step")).toHaveAttribute("data-step", "work-list");
    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.queryByText("job")).not.toBeInTheDocument();
  });

  it("the underlying kind value saved in the draft is still the data-contract \"job\", not \"position\"", async () => {
    const user = userEvent.setup();
    let captured: WorkSubdomainDraft[] = [];
    render(<WorkStep onBack={noop} onNext={(drafts) => (captured = drafts)} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    await user.type(screen.getByTestId("work-subdomain-name"), "Acme Inc");
    await user.click(screen.getByTestId("onboarding-next"));
    await user.click(screen.getByTestId("onboarding-next"));
    expect(captured).toEqual([expect.objectContaining({ kind: "job", label: "Acme Inc" })]);
  });

  it('"Add Later" is offered on the empty list and advances with zero drafts', async () => {
    const user = userEvent.setup();
    let captured: WorkSubdomainDraft[] | null = null;
    render(<WorkStep onBack={noop} onNext={(drafts) => (captured = drafts)} progressTotal={4} progressIndex={1} />);
    expect(screen.getByTestId("work-add-later")).toBeInTheDocument();
    await user.click(screen.getByTestId("work-add-later"));
    expect(captured).toEqual([]);
  });

  it('"Add Later" disappears once at least one subdomain has been added -- Continue is the real path by then', async () => {
    const user = userEvent.setup();
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    await user.click(screen.getByTestId("work-add-subdomain"));
    await user.click(screen.getByTestId("work-kind-position"));
    await user.type(screen.getByTestId("work-subdomain-name"), "Acme Inc");
    await user.click(screen.getByTestId("onboarding-next"));
    expect(screen.queryByTestId("work-add-later")).not.toBeInTheDocument();
    expect(screen.getByTestId("onboarding-next")).not.toBeDisabled();
  });

  it("Continue on the empty list is still disabled -- Add Later is a distinct, explicit action, not a silent relaxation of the minimum-one rule", () => {
    render(<WorkStep onBack={noop} onNext={noop} progressTotal={4} progressIndex={1} />);
    expect(screen.getByTestId("onboarding-next")).toBeDisabled();
  });
});
