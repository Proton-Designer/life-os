import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@/app/(app)/settings/focus-target-actions", () => ({ saveFocusTargets: saveMock }));

import { FocusTargetSettings } from "../focus-target-settings";

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({ ok: true });
});

describe("FocusTargetSettings", () => {
  it("shows the 4:00 default when nothing is stored, with the weekend override off", () => {
    render(<FocusTargetSettings initial={{ dailyMinutes: null, weekendMinutes: null }} />);
    expect((screen.getByLabelText("Daily target hours") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("Daily target minutes") as HTMLInputElement).value).toBe("0");
    expect(screen.queryByLabelText("Weekend target hours")).not.toBeInTheDocument();
  });

  it("saves hours+minutes as total minutes, with the weekend target null while the override is off", async () => {
    render(<FocusTargetSettings initial={{ dailyMinutes: null, weekendMinutes: null }} />);
    fireEvent.change(screen.getByLabelText("Daily target hours"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Daily target minutes"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByText("Saved.")).toBeInTheDocument(); // optimistic: before the action resolves
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ dailyMinutes: 330, weekendMinutes: null }));
  });

  it("a weekend target is sent only when the override is ticked", async () => {
    render(<FocusTargetSettings initial={{ dailyMinutes: 240, weekendMinutes: null }} />);
    fireEvent.click(screen.getByLabelText("Different target on weekends"));
    fireEvent.change(screen.getByLabelText("Weekend target hours"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Weekend target minutes"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ dailyMinutes: 240, weekendMinutes: 120 }));
  });

  it("refuses an out-of-range target without calling the action", () => {
    render(<FocusTargetSettings initial={{ dailyMinutes: null, weekendMinutes: null }} />);
    fireEvent.change(screen.getByLabelText("Daily target hours"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Daily target minutes"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByText(/between 30/)).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("the optimistic 'Saved.' flips to the error when the server refuses", async () => {
    saveMock.mockResolvedValue({ ok: false, message: "No settings row." });
    render(<FocusTargetSettings initial={{ dailyMinutes: 240, weekendMinutes: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(await screen.findByText("No settings row.")).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("'Use default' clears both targets (null), and resets the fields", async () => {
    render(<FocusTargetSettings initial={{ dailyMinutes: 330, weekendMinutes: 120 }} />);
    fireEvent.click(screen.getByRole("button", { name: /Use default/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ dailyMinutes: null, weekendMinutes: null }));
    expect((screen.getByLabelText("Daily target hours") as HTMLInputElement).value).toBe("4");
  });
});
