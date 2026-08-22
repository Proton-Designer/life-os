import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationCheckin, minutesAtPointer } from "../allocation-checkin";
import { emptyAllocation, type Allocation, type DomainKey } from "@/lib/checkins/allocation";

function alloc(partial: Partial<Allocation>): Allocation {
  return { ...emptyAllocation(), ...partial };
}

describe("AllocationCheckin", () => {
  let onSave: ReturnType<typeof vi.fn<(allocation: Allocation) => Promise<void>>>;

  beforeEach(() => {
    onSave = vi.fn().mockResolvedValue(undefined);
  });

  function renderCheckin(overrides: Partial<React.ComponentProps<typeof AllocationCheckin>> = {}) {
    return render(
      <AllocationCheckin
        windowStart="2026-08-19T19:00:00.000Z"
        windowEnd="2026-08-19T21:00:00.000Z"
        timezone="America/Chicago"
        initialAllocation={emptyAllocation()}
        onSave={onSave}
        {...overrides}
      />
    );
  }

  it("renders every domain row with a formatted minutes value, showing '0m' for zero", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 15, business: 60 }) });
    expect(screen.getByText("Deen")).toBeInTheDocument();
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
    // School/Fitness/Work are all zero — at least one "0m" per unset domain.
    expect(screen.getAllByText("0m").length).toBeGreaterThanOrEqual(3);
  });

  it("derives and renders Wasted from the allocation, never as an input", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 15, business: 60 }) });
    // 120 - 75 = 45 wasted.
    expect(screen.getByText("Wasted")).toBeInTheDocument();
    expect(screen.getByText("45m")).toBeInTheDocument();
  });

  it("never renders the words signal, noise, or priority — domains stay neutral in the UI", () => {
    renderCheckin({ initialAllocation: alloc({ school: 30, fitness: 15 }) });
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/signal|noise|priority/);
  });

  it("increments a domain by 15 minutes on +", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 0 }) });
    await user.click(screen.getByRole("button", { name: "Increase Deen" }));
    expect(within(screen.getByTestId("row-deen")).getByText("15m")).toBeInTheDocument();
  });

  it("decrements a domain by 15 minutes on −", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 30 }) });
    await user.click(screen.getByRole("button", { name: "Decrease Deen" }));
    expect(within(screen.getByTestId("row-deen")).getByText("15m")).toBeInTheDocument();
  });

  it("disables − for a domain already at 0", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 0 }) });
    expect(screen.getByRole("button", { name: "Decrease Deen" })).toBeDisabled();
  });

  it("visibly disables + for every domain once the pool is full, rather than letting it silently no-op", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 120 }) });
    const plus = screen.getByRole("button", { name: "Increase Business" });
    expect(plus).toBeDisabled();
    await user.click(plus);
    // Still 0 — nothing happened, and it was disabled rather than a silent no-op.
    expect(within(screen.getByTestId("row-business")).getByText("0m")).toBeInTheDocument();
  });

  it("selecting a domain marks it selected and dims the others", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 15, business: 15 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    expect(screen.getByTestId("row-deen")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("row-business")).toHaveAttribute("data-selected", "false");
  });

  it("tapping a selected domain again deselects it", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 15 }) });
    const select = screen.getByRole("button", { name: "Select Deen" });
    await user.click(select);
    await user.click(select);
    expect(screen.getByTestId("row-deen")).toHaveAttribute("data-selected", "false");
  });

  it("clicking outside the bar and the domain rows clears the selection", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 15 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    expect(screen.getByTestId("row-deen")).toHaveAttribute("data-selected", "true");
    await user.click(screen.getByText("Unassigned time counts as wasted."));
    expect(screen.getByTestId("row-deen")).toHaveAttribute("data-selected", "false");
  });

  it("selecting a different domain reassigns selection without clearing it first", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 15, business: 15 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    await user.click(screen.getByRole("button", { name: "Select Business" }));
    expect(screen.getByTestId("row-deen")).toHaveAttribute("data-selected", "false");
    expect(screen.getByTestId("row-business")).toHaveAttribute("data-selected", "true");
  });

  it("shows the drag cursor on the bar as soon as a domain is selected, even at 0 minutes", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 0 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    expect(screen.getByTestId("allocation-bar").className).toMatch(/cursor-ew-resize/);
  });

  it("pressing the bar for a selected domain still at 0 starts a small block instead of doing nothing", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 0 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 0, pointerId: 1 });
    expect(within(screen.getByTestId("row-deen")).getByText("5m")).toBeInTheDocument();
  });

  it("does not start a block from a bar press when the pool is already full", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 0, business: 120 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    fireEvent.pointerDown(screen.getByTestId("allocation-bar"), { clientX: 0, pointerId: 1 });
    expect(within(screen.getByTestId("row-deen")).getByText("0m")).toBeInTheDocument();
  });

  it("exposes the selected domain's segment as a slider with correct aria bounds", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 30, business: 30 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    const slider = screen.getByRole("slider", { name: "Deen minutes" });
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    // ceiling = own (30) + wasted (60) = 90
    expect(slider).toHaveAttribute("aria-valuemax", "90");
  });

  it("no slider is rendered when nothing is selected", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 30 }) });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("ArrowRight on the slider increments by one step, ArrowLeft decrements", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 30 }) });
    await user.click(screen.getByRole("button", { name: "Select Deen" }));
    const slider = screen.getByRole("slider", { name: "Deen minutes" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(screen.getByTestId("row-deen")).getByText("45m")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(screen.getByTestId("row-deen")).getByText("15m")).toBeInTheDocument();
  });

  it("a full allocation is keyboard-completable without ever dragging — every control is a real, focusable button", () => {
    renderCheckin({ initialAllocation: emptyAllocation() });
    for (const domain of ["Deen", "Business", "School", "Fitness", "Work"]) {
      const plus = screen.getByRole("button", { name: `Increase ${domain}` });
      const minus = screen.getByRole("button", { name: `Decrease ${domain}` });
      const select = screen.getByRole("button", { name: `Select ${domain}` });
      expect(plus.tagName).toBe("BUTTON");
      expect(minus.tagName).toBe("BUTTON");
      expect(select.tagName).toBe("BUTTON");
    }
  });

  it("marks pre-filled domains with a visible, non-color-only label, not a subtle color-only tell", () => {
    renderCheckin({
      initialAllocation: alloc({ business: 60 }),
      prefilled: { business: true },
    });
    expect(within(screen.getByTestId("row-business")).getByText(/app filled this in|guessed/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("row-deen")).queryByText(/app filled this in|guessed/i)).not.toBeInTheDocument();
  });

  it("renders Wasted with a neutral/muted treatment, never the destructive/noise accent", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 60 }) });
    const wastedRow = screen.getByTestId("row-wasted");
    expect(wastedRow.innerHTML).not.toMatch(/destructive|accent-noise/i);
  });

  it("shows the queue position indicator only when queuePosition is passed", () => {
    const { rerender } = renderCheckin();
    expect(screen.queryByText(/1 of/i)).not.toBeInTheDocument();
    rerender(
      <AllocationCheckin
        windowStart="2026-08-19T19:00:00.000Z"
        windowEnd="2026-08-19T21:00:00.000Z"
        timezone="America/Chicago"
        initialAllocation={emptyAllocation()}
        onSave={onSave}
        queuePosition={{ index: 1, total: 3 }}
      />
    );
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
  });

  it("calls onSave with the current allocation when Done is pressed", async () => {
    const user = userEvent.setup();
    renderCheckin({ initialAllocation: alloc({ deen: 30 }) });
    await user.click(screen.getByRole("button", { name: "Increase Deen" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onSave).toHaveBeenCalledWith(alloc({ deen: 45 }));
  });

  it("every interactive control meets the 44px minimum tap target", () => {
    renderCheckin({ initialAllocation: alloc({ deen: 30 }) });
    const controls = [
      ...screen.getAllByRole("button"),
    ];
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      expect(el.className).toMatch(/min-h-11|size-11/);
    }
  });

  it("renders a real-past-tense window label once the window has already closed", () => {
    renderCheckin({
      windowStart: "2020-01-01T14:00:00.000Z",
      windowEnd: "2020-01-01T16:00:00.000Z",
    });
    expect(screen.getByTestId("window-label")).toHaveTextContent(/ago|earlier|this afternoon|closed/i);
  });
});

describe("minutesAtPointer (pure UI-geometry helper, not allocation logic)", () => {
  const DOMAIN: DomainKey = "business";

  it("maps the left edge of the bar to 0 minus what's already allocated before the domain", () => {
    const a = alloc({ deen: 30, business: 15 });
    const result = minutesAtPointer(0, { left: 0, width: 200 }, a, DOMAIN);
    expect(result).toBe(0 - 30);
  });

  it("maps the right edge of the bar to TOTAL_MINUTES minus what's before the domain", () => {
    const a = alloc({ deen: 30, business: 15 });
    const result = minutesAtPointer(200, { left: 0, width: 200 }, a, DOMAIN);
    expect(result).toBe(120 - 30);
  });

  it("clamps pointer input to the bar's own bounds before converting", () => {
    const a = alloc({ deen: 0, business: 0 });
    const beforeLeft = minutesAtPointer(-50, { left: 0, width: 200 }, a, DOMAIN);
    const afterRight = minutesAtPointer(500, { left: 0, width: 200 }, a, DOMAIN);
    expect(beforeLeft).toBe(0);
    expect(afterRight).toBe(120);
  });
});
