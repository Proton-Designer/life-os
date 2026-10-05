import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrequencyPicker, isFrequencyValid } from "../frequency-picker";
import { DAILY, normalizeFrequency, type HabitFrequency } from "@/lib/habits/frequency";

/** Controlled harness that also reports every emitted value, like a real form would hold it. */
function Harness({ initial = DAILY, onValue }: { initial?: HabitFrequency; onValue?: (f: HabitFrequency) => void }) {
  const [value, setValue] = useState<HabitFrequency>(initial);
  return (
    <FrequencyPicker
      value={value}
      onChange={(f) => {
        setValue(f);
        onValue?.(f);
      }}
    />
  );
}

describe("FrequencyPicker", () => {
  it("offers the five cadences and starts on the one it is given", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "How often" });
    for (const label of ["Every day", "Certain days", "Per week", "Per month", "Every…"]) expect(within(group).getByRole("radio", { name: label })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Every day" })).toBeChecked();
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Every day");
  });

  it("'Certain days': defaults to Mon/Wed/Fri, toggles days, summarises them, and flags an empty selection", async () => {
    const user = userEvent.setup();
    const seen: HabitFrequency[] = [];
    render(<Harness onValue={(f) => seen.push(f)} />);
    await user.click(screen.getByRole("radio", { name: "Certain days" }));
    expect(seen.at(-1)).toEqual({ kind: "weekdays", days: [1, 3, 5] });
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Mon · Wed · Fri");

    await user.click(screen.getByRole("button", { name: "Tuesday" }));
    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");
    expect(seen.at(-1)).toEqual({ kind: "weekdays", days: [1, 2, 3, 5] });

    for (const d of ["Monday", "Tuesday", "Wednesday", "Friday"]) await user.click(screen.getByRole("button", { name: d }));
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Pick at least one day");
    expect(isFrequencyValid(seen.at(-1)!)).toBe(false);
  });

  it("'Per week' and 'Per month' take a count, with the valid range enforced in the summary", async () => {
    const user = userEvent.setup();
    const seen: HabitFrequency[] = [];
    render(<Harness onValue={(f) => seen.push(f)} />);
    await user.click(screen.getByRole("radio", { name: "Per week" }));
    const count = screen.getByRole("spinbutton", { name: "Times per week" });
    expect(count).toHaveValue(3);
    await user.clear(count);
    await user.type(count, "2");
    expect(seen.at(-1)).toEqual({ kind: "per_week", count: 2 });
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Twice a week");
    await user.clear(count);
    await user.type(count, "7");
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent(/1 to 6 times a week/); // 7 would be every day
    expect(isFrequencyValid(seen.at(-1)!)).toBe(false);

    await user.click(screen.getByRole("radio", { name: "Per month" }));
    expect(screen.getByRole("spinbutton", { name: "Times per month" })).toHaveValue(2);
    expect(seen.at(-1)).toEqual({ kind: "per_month", count: 2 });
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Twice a month");
  });

  it("'Every…' counts in days or weeks, stored as days; switching unit keeps the number", async () => {
    const user = userEvent.setup();
    const seen: HabitFrequency[] = [];
    render(<Harness onValue={(f) => seen.push(f)} />);
    await user.click(screen.getByRole("radio", { name: "Every…" }));
    expect(seen.at(-1)).toEqual({ kind: "every_n_days", interval: 3 });
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Every 3 days");

    await user.click(screen.getByRole("radio", { name: "weeks" }));
    expect(seen.at(-1)).toEqual({ kind: "every_n_days", interval: 21 }); // "3 weeks"
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Every 3 weeks");
    const weeks = screen.getByRole("spinbutton", { name: "Weeks between" });
    await user.clear(weeks);
    await user.type(weeks, "2");
    expect(seen.at(-1)).toEqual({ kind: "every_n_days", interval: 14 });
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Every 2 weeks");

    await user.click(screen.getByRole("radio", { name: "days" }));
    expect(screen.getByRole("spinbutton", { name: "Days between" })).toHaveValue(2);
    expect(seen.at(-1)).toEqual({ kind: "every_n_days", interval: 2 });
  });

  it("an existing 'every 2 weeks' reopens in weeks, and an existing weekday set shows those days pressed", () => {
    const { unmount } = render(<Harness initial={{ kind: "every_n_days", interval: 14 }} />);
    expect(screen.getByRole("spinbutton", { name: "Weeks between" })).toHaveValue(2);
    unmount();
    render(<Harness initial={{ kind: "weekdays", days: [0, 6] }} />);
    expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("frequency-summary")).toHaveTextContent("Weekends");
  });

  it("everything the picker emits as valid is accepted by the server-side normalizer (same rule, one place)", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    for (const kind of ["Certain days", "Per week", "Per month", "Every…", "Every day"]) {
      await user.click(screen.getByRole("radio", { name: kind }));
      const last = onValue.mock.calls.at(-1)![0] as HabitFrequency;
      expect(isFrequencyValid(last)).toBe(true);
      expect(() => normalizeFrequency(last)).not.toThrow();
    }
  });
});
