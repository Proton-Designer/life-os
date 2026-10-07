import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(async (..._a: unknown[]): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }));
vi.mock("@/app/(app)/settings/quran-reminder-actions", () => ({ saveQuranReminderWindow: (...a: unknown[]) => save(...a) }));

import { QuranReminderSettings } from "../quran-reminder-settings";
import { pickTime12, readTime12 } from "@/components/ui/__tests__/time-field-helper";

describe("QuranReminderSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unset = the 10 PM -> 1 AM defaults, with the helper text", () => {
    render(<QuranReminderSettings initialStart={null} initialEnd={null} />);
    expect(readTime12("Quran reminder starts")).toBe("10:00 PM");
    expect(readTime12("Quran reminder ends")).toBe("1:00 AM");
    expect(screen.getByText(/When today's Quran portion shows on Home\. Outside these hours it stays on the Faith page\./)).toBeInTheDocument();
  });

  it("shows stored values and saves the picked window as 24-hour HH:MM", async () => {
    const user = userEvent.setup();
    render(<QuranReminderSettings initialStart="21:00" initialEnd="23:30" />);
    expect(readTime12("Quran reminder starts")).toBe("9:00 PM");
    await pickTime12(user, "Quran reminder ends", "12:30 AM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ start: "21:00", end: "00:30" });
    expect(await screen.findByRole("status")).toHaveTextContent("9:00 PM to 12:30 AM");
  });

  it("start == end is refused before any server call", async () => {
    const user = userEvent.setup();
    render(<QuranReminderSettings initialStart="22:00" initialEnd="22:00" />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't be the same/);
    expect(save).not.toHaveBeenCalled();
  });

  it("relays a server refusal", async () => {
    save.mockResolvedValueOnce({ ok: false, message: "Deen Mode is off" });
    const user = userEvent.setup();
    render(<QuranReminderSettings initialStart={null} initialEnd={null} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deen Mode is off");
  });
});
