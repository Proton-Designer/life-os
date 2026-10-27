import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@/app/(app)/settings/self-mastery-actions", () => ({ saveSelfMasterySettings: saveMock }));

import { SelfMasterySettings } from "../self-mastery-settings";

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({ ok: true });
});

describe("SelfMasterySettings", () => {
  it("shows the stored values", () => {
    render(<SelfMasterySettings initial={{ dailyNewLimit: 12, sessionTargetMinutes: 15 }} />);
    expect((screen.getByLabelText("New cards per day") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("Daily session length (minutes)") as HTMLInputElement).value).toBe("15");
  });

  it("saves both numbers", async () => {
    render(<SelfMasterySettings initial={{ dailyNewLimit: 5, sessionTargetMinutes: 8 }} />);
    fireEvent.change(screen.getByLabelText("New cards per day"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Daily session length (minutes)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ dailyNewLimit: 10, sessionTargetMinutes: 12 }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("refuses an out-of-range value without calling the action", () => {
    render(<SelfMasterySettings initial={{ dailyNewLimit: 5, sessionTargetMinutes: 8 }} />);
    fireEvent.change(screen.getByLabelText("Daily session length (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Daily session length must be/);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("an empty field is not silently saved as 0", () => {
    render(<SelfMasterySettings initial={{ dailyNewLimit: 5, sessionTargetMinutes: 8 }} />);
    fireEvent.change(screen.getByLabelText("New cards per day"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    saveMock.mockResolvedValue({ ok: false, message: "No settings row." });
    render(<SelfMasterySettings initial={{ dailyNewLimit: 5, sessionTargetMinutes: 8 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("No settings row.")).toBeInTheDocument();
  });
});
