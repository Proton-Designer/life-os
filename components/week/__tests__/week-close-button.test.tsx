import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));

import { WeekCloseButton, WeekDoneButton, shouldGoBack } from "../week-close-button";

function setup(referrer: string, length: number) {
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  Object.defineProperty(window.history, "length", { value: length, configurable: true });
}

beforeEach(() => {
  back.mockReset();
  push.mockReset();
});

describe("shouldGoBack", () => {
  const o = "http://localhost:3000";
  it("goes back for an in-app or empty referrer with history", () => {
    expect(shouldGoBack(`${o}/`, o, 3)).toBe(true);
    expect(shouldGoBack("", o, 3)).toBe(true);
  });
  it("goes Home for an external referrer or no history (positive controls)", () => {
    expect(shouldGoBack("https://example.com/x", o, 3)).toBe(false);
    expect(shouldGoBack(`${o}/`, o, 1)).toBe(false);
    expect(shouldGoBack("not a url", o, 3)).toBe(false);
  });
});

describe("WeekCloseButton", () => {
  it("has an accessible name and goes back from inside the app", () => {
    setup(`${window.location.origin}/`, 4);
    render(<WeekCloseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Close weekly reset" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
  it("goes Home when arriving from outside", () => {
    setup("https://example.com/", 4);
    render(<WeekCloseButton />);
    fireEvent.click(screen.getByTestId("week-close"));
    expect(push).toHaveBeenCalledWith("/");
    expect(back).not.toHaveBeenCalled();
  });
  it("Escape leaves, but not from an input or a dialog", () => {
    setup(`${window.location.origin}/`, 4);
    render(
      <div>
        <WeekCloseButton />
        <input aria-label="goal" />
        <div role="dialog"><button>in dialog</button></div>
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("goal"), { key: "Escape" });
    fireEvent.keyDown(screen.getByText("in dialog"), { key: "Escape" });
    expect(back).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("WeekDoneButton", () => {
  it("leaves the same way", () => {
    setup("", 1);
    render(<WeekDoneButton />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
