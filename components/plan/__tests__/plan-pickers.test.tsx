import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DurationField } from "../duration-field";
import { QuickTimeField } from "../quick-time-field";

function Time({ initial = "", relativeToNow = false }: { initial?: string; relativeToNow?: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <QuickTimeField value={v} onChange={setV} timezone="America/Chicago" relativeToNow={relativeToNow} />
      <output data-testid="out">{v}</output>
    </>
  );
}
function Duration({ initial = null }: { initial?: number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <DurationField value={v} onChange={setV} />
      <output data-testid="out">{String(v)}</output>
    </>
  );
}

describe("QuickTimeField (wheel)", () => {
  it("is one quiet pill until opened, and shows 12-hour time", async () => {
    const user = userEvent.setup();
    render(<Time />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /set start time/i }));
    expect(screen.getByTestId("out")).toHaveTextContent("09:00"); // tonight's plan opens on 9:00 AM
    expect(screen.getAllByRole("listbox")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /9:00 AM/ })).toBeInTheDocument();
  });

  it("the wheels write 24-hour storage: PM flips the hour, arrows step the minute", async () => {
    const user = userEvent.setup();
    render(<Time initial="09:00" />);
    await user.click(screen.getByRole("button", { name: /change/i }));
    await user.click(screen.getByRole("option", { name: "PM" }));
    expect(screen.getByTestId("out")).toHaveTextContent("21:00");
    const minute = screen.getByRole("listbox", { name: "Start time minute" });
    minute.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByTestId("out")).toHaveTextContent("21:02");
  });

  it("12 AM is 00:00 and 12 PM is 12:00", async () => {
    const user = userEvent.setup();
    render(<Time initial="09:00" />);
    await user.click(screen.getByRole("button", { name: /change/i }));
    await user.click(within(screen.getByRole("listbox", { name: "Start time hour" })).getByRole("option", { name: "12" }));
    expect(screen.getByTestId("out")).toHaveTextContent("00:00");
    await user.click(screen.getByRole("option", { name: "PM" }));
    expect(screen.getByTestId("out")).toHaveTextContent("12:00");
  });

  it("Clear removes the time", async () => {
    const user = userEvent.setup();
    render(<Time initial="06:30" />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("out")).toHaveTextContent("");
  });
});

describe("DurationField (slider + box)", () => {
  it("the slider moves in 15-minute steps and 0 means no timer", () => {
    render(<Duration />);
    const slider = screen.getByLabelText("Timer length slider") as HTMLInputElement;
    expect(slider.step).toBe("15");
    fireEvent.change(slider, { target: { value: "90" } });
    expect(screen.getByTestId("out")).toHaveTextContent("90");
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByTestId("out")).toHaveTextContent("null");
    expect(screen.getByText("No timer")).toBeInTheDocument();
  });

  it("the box takes an exact value (any minutes) and the slider follows", async () => {
    const user = userEvent.setup();
    render(<Duration />);
    await user.type(screen.getByLabelText("Timer minutes"), "50");
    await user.tab();
    expect(screen.getByTestId("out")).toHaveTextContent("50");
    expect(screen.getByText("50m")).toBeInTheDocument();
  });

  it("caps at a day and ignores non-digits", async () => {
    const user = userEvent.setup();
    render(<Duration />);
    await user.type(screen.getByLabelText("Timer minutes"), "9x999");
    await user.tab();
    expect(screen.getByTestId("out")).toHaveTextContent("1440");
  });
});
