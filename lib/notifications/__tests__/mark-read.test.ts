import { describe, expect, it, vi, beforeEach } from "vitest";

const upsertMock = vi.fn(async (): Promise<{ error: { message: string; code: string } | null }> => ({ error: null }));
const fromMock = vi.fn(() => ({ upsert: upsertMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { markNotificationRead } from "../mark-read";

describe("markNotificationRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({ error: null });
  });

  it("upserts against notification_reads with ignoreDuplicates — ON CONFLICT DO NOTHING, not a throwing insert", async () => {
    await markNotificationRead("user-1", "prayer-fajr", "2026-08-19");

    expect(fromMock).toHaveBeenCalledWith("notification_reads");
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: "user-1", notification_key: "prayer-fajr", date: "2026-08-19" },
      { onConflict: "user_id,notification_key,date", ignoreDuplicates: true }
    );
  });

  it("throws on a real database error, not just a conflict", async () => {
    upsertMock.mockResolvedValue({ error: { message: "connection lost", code: "08000" } });

    await expect(markNotificationRead("user-1", "prayer-fajr", "2026-08-19")).rejects.toBeTruthy();
  });
});
