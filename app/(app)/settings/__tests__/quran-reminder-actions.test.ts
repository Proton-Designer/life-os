import { beforeEach, describe, expect, it, vi } from "vitest";

let deenOn = true;
const revalidate = vi.fn();
const update = vi.fn();
const upsert = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));
vi.mock("@/lib/deen/deen-mode-guard", () => ({ isDeenModeOnForRequest: async () => deenOn, DEEN_MODE_OFF_MESSAGE: "Faith Mode is off" }));
// A tiny user_settings client: upsert (ensure the row) then update(...).eq(...).select(...)
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: async () => ({
    userId: "u1",
    supabase: {
      from: () => ({
        upsert: async (...a: unknown[]) => (upsert(...a), { error: null }),
        update: (patch: unknown) => ({ eq: () => ({ select: async () => (update(patch), { data: [{ user_id: "u1" }], error: null }) }) }),
      }),
    },
  }),
}));

import { saveQuranReminderWindow } from "../quran-reminder-actions";

describe("saveQuranReminderWindow", () => {
  beforeEach(() => {
    deenOn = true;
    vi.clearAllMocks();
  });
  it("saves a valid window and revalidates Home and Settings", async () => {
    expect(await saveQuranReminderWindow({ start: "21:30", end: "00:30" })).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ quran_reminder_start: "21:30", quran_reminder_end: "00:30" });
    expect(revalidate).toHaveBeenCalledWith("/");
    expect(revalidate).toHaveBeenCalledWith("/settings");
  });
  it("refuses start == end with a clear message and writes nothing", async () => {
    const res = await saveQuranReminderWindow({ start: "22:00", end: "22:00" });
    expect(res).toEqual({ ok: false, message: expect.stringMatching(/can't be the same/) });
    expect(update).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("refuses a malformed time (24-hour 'HH:MM' only)", async () => {
    expect(await saveQuranReminderWindow({ start: "9:00 PM", end: "01:00" })).toEqual({ ok: false, message: expect.stringMatching(/valid start/) });
    expect(await saveQuranReminderWindow({ start: "22:00", end: "25:00" })).toEqual({ ok: false, message: expect.stringMatching(/valid end/) });
    expect(update).not.toHaveBeenCalled();
  });
  it("Faith Mode OFF: refused server-side, stored data untouched", async () => {
    deenOn = false;
    expect(await saveQuranReminderWindow({ start: "22:00", end: "01:00" })).toEqual({ ok: false, message: "Faith Mode is off" });
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
