import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeField12 } from "../time-field-12";
import { pickTime12, readTime12 } from "./time-field-helper";

function Harness({ initial, onValue, step, defaultOpenValue }: { initial: string; onValue?: (v: string) => void; step?: number; defaultOpenValue?: string }) {
  const [v, setV] = useState(initial);
  return (
    <TimeField12
      value={v}
      minuteStep={step}
      defaultOpenValue={defaultOpenValue}
      aria-label="Wake time"
      onChange={(n) => {
        setV(n);
        onValue?.(n);
      }}
    />
  );
}
const pill = () => screen.getByRole("button", { name: /^(Set Wake time|Wake time: )/ });
const list = (name: string) => screen.getByRole("listbox", { name: `Wake time ${name}` });
const options = (name: string) => within(list(name)).getAllByRole("option").map((o) => o.textContent);
const selected = (name: string) => within(list(name)).getByRole("option", { selected: true }).textContent;

describe("TimeField12", () => {
  it("shows a stored 24-hour value in 12-hour form on the pill, and in the wheel when opened", async () => {
    const user = userEvent.setup();
    render(<Harness initial="21:30" />);
    expect(pill()).toHaveAccessibleName("Wake time: 9:30 PM. Change");
    expect(readTime12("Wake time")).toBe("9:30 PM");
    await user.click(pill());
    expect(selected("hour")).toBe("9");
    expect(selected("minute")).toBe("30");
    expect(selected("AM or PM")).toBe("PM");
  });

  it("emits 24-hour 'HH:MM' for every change, including the 12 AM / 12 PM edges", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="06:00" onValue={onValue} />);
    await user.click(pill());
    await user.click(within(list("AM or PM")).getByRole("option", { name: "PM" }));
    expect(onValue).toHaveBeenLastCalledWith("18:00");
    await user.click(within(list("hour")).getByRole("option", { name: "12" }));
    expect(onValue).toHaveBeenLastCalledWith("12:00"); // 12 PM = noon
    await user.click(within(list("AM or PM")).getByRole("option", { name: "AM" }));
    expect(onValue).toHaveBeenLastCalledWith("00:00"); // 12 AM = midnight
    await user.click(within(list("minute")).getByRole("option", { name: "45" }));
    expect(onValue).toHaveBeenLastCalledWith("00:45");
  });

  it("offers only 1-12 hours and 5-minute steps by default (plus a stored off-step minute so nothing is silently rounded)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness initial="08:00" />);
    await user.click(pill());
    expect(options("hour")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(options("minute")).toHaveLength(12);
    unmount();
    render(<Harness initial="20:48" />);
    expect(readTime12("Wake time")).toBe("8:48 PM");
    await user.click(pill());
    expect(options("minute")).toContain("48");
    expect(options("minute")).toHaveLength(13);
    expect(selected("minute")).toBe("48");
  });

  it("a custom minute step is honoured", async () => {
    const user = userEvent.setup();
    render(<Harness initial="08:00" step={15} />);
    await user.click(pill());
    expect(options("minute")).toEqual(["00", "15", "30", "45"]);
  });

  it("empty value: shows 'Set time'; opening emits defaultOpenValue (09:00 unless given) and lands the wheel there", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    const { unmount } = render(<Harness initial="" onValue={onValue} />);
    expect(pill()).toHaveAccessibleName("Set Wake time");
    expect(pill()).toHaveTextContent("Set time");
    expect(readTime12("Wake time")).toBe("");
    await user.click(pill());
    expect(onValue).toHaveBeenLastCalledWith("09:00");
    expect(selected("hour")).toBe("9");
    unmount();
    render(<Harness initial="" onValue={onValue} defaultOpenValue="07:15" />);
    await user.click(pill());
    expect(onValue).toHaveBeenLastCalledWith("07:15");
    expect(readTime12("Wake time")).toBe("7:15 AM");
  });

  it("Done closes; Clear (only when set) empties the value and closes", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="07:00" onValue={onValue} />);
    await user.click(pill());
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("listbox", { name: "Wake time hour" })).toBeNull();
    await user.click(pill());
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onValue).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("listbox", { name: "Wake time hour" })).toBeNull();
    await user.click(pill()); // empty again: opening refills, and there is nothing to Clear until then
    expect(onValue).toHaveBeenLastCalledWith("09:00");
  });

  it("Clear is not offered on an empty value before it is opened", () => {
    render(<Harness initial="" />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("pickTime12 helper round-trips a time through the real UI", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="" onValue={onValue} />);
    await pickTime12(user, "Wake time", "6:30 AM");
    expect(onValue).toHaveBeenLastCalledWith("06:30");
    expect(readTime12("Wake time")).toBe("6:30 AM");
  });

  it("never offers a 24-hour hour (positive control for the above)", async () => {
    const user = userEvent.setup();
    render(<Harness initial="23:00" />);
    await user.click(pill());
    expect(options("hour").some((h) => Number(h) > 12)).toBe(false);
    expect(selected("hour")).toBe("11");
  });

  it("disabled: the pill cannot be opened", async () => {
    const user = userEvent.setup();
    render(<TimeField12 value="07:00" onChange={() => {}} aria-label="Wake time" disabled />);
    expect(pill()).toBeDisabled();
    await user.click(pill());
    expect(screen.queryByRole("listbox", { name: "Wake time hour" })).toBeNull();
  });
});
