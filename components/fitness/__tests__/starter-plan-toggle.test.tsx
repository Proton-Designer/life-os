import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StarterPlanToggle } from "../starter-plan-toggle";

describe("StarterPlanToggle", () => {
  it("shows an addition framing, not an alternative — mentions it stacks with a session plan", () => {
    render(<StarterPlanToggle adopted={false} onAdopt={vi.fn()} />);
    expect(screen.getByText(/stacks with a session plan/)).toBeInTheDocument();
  });

  it("tapping Start this calls onAdopt", async () => {
    const user = userEvent.setup();
    const onAdopt = vi.fn().mockResolvedValue(undefined);
    render(<StarterPlanToggle adopted={false} onAdopt={onAdopt} />);
    await user.click(screen.getByRole("button", { name: "Start this" }));
    expect(onAdopt).toHaveBeenCalled();
  });

  it("shows a quiet adopted state with no button once active", () => {
    render(<StarterPlanToggle adopted={true} onAdopt={vi.fn()} />);
    expect(screen.getByTestId("starter-plan-adopted")).toHaveTextContent("Daily rep target active");
    expect(screen.queryByRole("button", { name: "Start this" })).not.toBeInTheDocument();
  });
});
