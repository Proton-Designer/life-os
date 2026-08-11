import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TravelingToggle } from "../traveling-toggle";

const setTravelingModeMock = vi.fn();
vi.mock("@/app/(app)/deen/actions", () => ({
  setTravelingMode: (...args: unknown[]) => setTravelingModeMock(...args),
}));

describe("TravelingToggle", () => {
  beforeEach(() => {
    setTravelingModeMock.mockReset();
  });

  it("flips checked state immediately, before setTravelingMode resolves", async () => {
    setTravelingModeMock.mockImplementation(() => new Promise<void>(() => {}));

    render(<TravelingToggle enabled={false} />);

    const user = userEvent.setup();
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(toggle).toBeChecked();
  });
});
