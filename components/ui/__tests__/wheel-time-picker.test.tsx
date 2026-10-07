import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WheelTimePicker } from "../wheel-time-picker";

function Harness({ initial, onValue, minuteStep }: { initial: string; onValue?: (v: string) => void; minuteStep?: number }) {
  const [v, setV] = useState(initial);
  return (
    <WheelTimePicker
      value={v}
      label="T"
      minuteStep={minuteStep}
      onChange={(n) => {
        setV(n);
        onValue?.(n);
      }}
    />
  );
}
const list = (name: string) => screen.getByRole("listbox", { name: `T ${name}` });
const opt = (name: string, text: string) => within(list(name)).getByRole("option", { name: text });

describe("WheelTimePicker", () => {
  it("lists every minute by default and keeps a stored off-step minute on a coarser step", () => {
    const { unmount } = render(<Harness initial="08:07" />);
    expect(within(list("minute")).getAllByRole("option")).toHaveLength(60);
    unmount();
    render(<Harness initial="20:48" minuteStep={5} />);
    expect(within(list("minute")).getAllByRole("option")).toHaveLength(13);
    expect(within(list("minute")).getByRole("option", { selected: true })).toHaveTextContent("48");
  });

  it("clicking a row picks it", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="09:00" onValue={onValue} />);
    await user.click(opt("hour", "4"));
    expect(onValue).toHaveBeenLastCalledWith("04:00");
    await user.click(opt("AM or PM", "PM"));
    expect(onValue).toHaveBeenLastCalledWith("16:00");
  });

  it("ArrowDown / ArrowUp step the focused wheel, wrapping at the ends", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial="00:00" onValue={onValue} />);
    list("hour").focus();
    await user.keyboard("{ArrowDown}");
    expect(onValue).toHaveBeenLastCalledWith("01:00"); // 12 AM -> 1 AM
    await user.keyboard("{ArrowUp}");
    expect(onValue).toHaveBeenLastCalledWith("00:00");
  });

  it("a mouse drag scrolls the wheel and picks the nearest row; the click after a real drag does not also pick a row", () => {
    const onValue = vi.fn();
    render(<Harness initial="09:00" onValue={onValue} />);
    const hour = list("hour");
    Object.assign(hour, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true, scrollTo: vi.fn() });
    hour.scrollTop = 8 * 30; // sitting on "9"
    fireEvent.pointerDown(hour, { pointerType: "mouse", pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(hour, { pointerType: "mouse", pointerId: 1, clientY: 140 }); // drag up 60px -> 2 rows further
    expect(hour.scrollTop).toBe(8 * 30 + 60);
    expect(hour.style.scrollSnapType).toBe("none");
    fireEvent.pointerUp(hour, { pointerType: "mouse", pointerId: 1, clientY: 140 });
    expect(onValue).toHaveBeenLastCalledWith("11:00");
    expect(hour.style.scrollSnapType).toBe("");
    onValue.mockClear();
    fireEvent.click(opt("hour", "1")); // the click a browser fires right after the release is swallowed
    expect(onValue).not.toHaveBeenCalled();
  });

  it("a press that barely moves is a click, not a drag; touch pointers are left to native scrolling", () => {
    const onValue = vi.fn();
    render(<Harness initial="09:00" onValue={onValue} />);
    const hour = list("hour");
    const capture = vi.fn();
    Object.assign(hour, { setPointerCapture: capture });
    fireEvent.pointerDown(hour, { pointerType: "mouse", pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(hour, { pointerType: "mouse", pointerId: 1, clientY: 202 });
    fireEvent.pointerUp(hour, { pointerType: "mouse", pointerId: 1, clientY: 202 });
    fireEvent.click(opt("hour", "3"));
    expect(onValue).toHaveBeenLastCalledWith("03:00");
    fireEvent.pointerDown(hour, { pointerType: "touch", pointerId: 2, clientY: 200 });
    fireEvent.pointerMove(hour, { pointerType: "touch", pointerId: 2, clientY: 100 });
    expect(capture).not.toHaveBeenCalled();
  });
});
