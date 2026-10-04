import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/wind-down-actions", () => ({ saveWindDownPlan: vi.fn() }));
import { WindDownCard } from "../wind-down-card";

const PLAN = { bedtime: "22:30", windDownStart: "21:45", windDownMinutes: 45 };

describe("WindDownCard (Home, Sleep plan ON)", () => {
  it("no plan yet: shows the one-time set-up with the shared form", () => {
    render(<WindDownCard settings={{ wakeTime: null, sleepNeedMinutes: null, windDownMinutes: null, plan: null }} />);
    expect(screen.getByTestId("wind-down-setup")).toBeInTheDocument();
    expect(screen.getByLabelText("Wake time")).toBeInTheDocument();
  });
  it("plan set: nothing (set once; Lights out by lives on the wind-down and done cards)", () => {
    const { container } = render(<WindDownCard settings={{ wakeTime: "06:30", sleepNeedMinutes: 480, windDownMinutes: 45, plan: PLAN }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
