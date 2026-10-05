import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeField12 } from "../time-field-12";

function Harness({ initial, onValue, step }: { initial: string; onValue?: (v: string) => void; step?: number }) {
  const [v, setV] = useState(initial);
  return (
    <TimeField12
      value={v}
      minuteStep={step}
      aria-label="Wake time"
      onChange={(n) => {
        setV(n);
        onValue?.(n);
      }}
    />
  );
}
const sel = (name: string) => screen.getByRole("combobox", { name: `Wake time ${name}` }) as HTMLSelectElement;

describe("TimeField12", () => {
  it("shows a stored 24-hour value in 12-hour form", () => {
    render(<Harness initial="21:30" />);
    expect(sel("hour").value).toBe("9");
    expect(sel("minute").value).toBe("30");
    expect(sel("AM or PM").value).toBe("PM");
  });

  it("emits 24-hour 'HH:MM' for every change, including the 12 AM / 12 PM edges", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="06:00" onValue={onValue} />);
    await user.selectOptions(sel("AM or PM"), "PM");
    expect(onValue).toHaveBeenLastCalledWith("18:00");
    await user.selectOptions(sel("hour"), "12");
    expect(onValue).toHaveBeenLastCalledWith("12:00"); // 12 PM = noon
    await user.selectOptions(sel("AM or PM"), "AM");
    expect(onValue).toHaveBeenLastCalledWith("00:00"); // 12 AM = midnight
    await user.selectOptions(sel("minute"), "45");
    expect(onValue).toHaveBeenLastCalledWith("00:45");
  });

  it("offers only 1-12 hours and 5-minute steps by default (plus a stored off-step minute so nothing is silently rounded)", () => {
    const { unmount } = render(<Harness initial="08:00" />);
    expect(Array.from(sel("hour").options).map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(Array.from(sel("minute").options)).toHaveLength(12);
    unmount();
    render(<Harness initial="20:48" />);
    expect(Array.from(sel("minute").options).map((o) => o.value)).toContain("48");
    expect(sel("minute").value).toBe("48");
  });

  it("a custom minute step is honoured", () => {
    render(<Harness initial="08:00" step={15} />);
    expect(Array.from(sel("minute").options).map((o) => o.value)).toEqual(["0", "15", "30", "45"]);
  });

  it("empty value: shows a dash, minute/AM-PM are disabled until an hour is chosen, then fills sensible defaults", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="" onValue={onValue} />);
    expect(sel("hour").value).toBe("");
    expect(sel("minute")).toBeDisabled();
    expect(sel("AM or PM")).toBeDisabled();
    await user.selectOptions(sel("hour"), "7");
    expect(onValue).toHaveBeenLastCalledWith("07:00");
    expect(sel("minute")).toBeEnabled();
  });

  it("never offers a 24-hour hour (positive control for the above)", () => {
    render(<Harness initial="23:00" />);
    expect(Array.from(sel("hour").options).some((o) => Number(o.value) > 12)).toBe(false);
    expect(sel("hour").value).toBe("11");
  });
});
