import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getWriteAction } from "../write-registry";
import { fakeSupabase, planRow } from "@/lib/quran/__tests__/fake-supabase";

// 2026-10-05 03:30Z is 22:30 on Oct 4 in Chicago: the handler must file under the user's LOCAL date.
const now = new Date("2026-10-05T03:30:00.000Z");
const action = () => getWriteAction("deen", "quran_plan", "log_reading")!;
const ctx = (f: ReturnType<typeof fakeSupabase>) => ({ userClient: f.client, userId: "user-1", timezone: "America/Chicago", now });
const text = (o: { result: { content: Array<{ type: string; text?: string }> } }) => JSON.parse(o.result.content[0].text!);

describe("deen.quran_plan.log_reading (MCP twin)", () => {
  it("is registered and non-idempotent, with a verification note", () => {
    expect(action().idempotent).toBe(false);
    expect((action().idempotencyVerification ?? "").length).toBeGreaterThan(20);
  });
  it("to_page logs through the shared core: bookmark moves, a span log is written under the LOCAL date", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    const out = await action().handler(ctx(f), { to_page: 20 });
    expect(text(out)).toMatchObject({ ok: true, fromPage: 11, toPage: 20, newCurrentPage: 21, date: "2026-10-04" });
    expect(f.tables.quran_plans[0].current_page).toBe(21);
    expect(f.tables.quran_sessions[0]).toMatchObject({ date: "2026-10-04", from_page: 11, to_page: 20, plan_id: "plan-1" });
  });
  it("next_page ('I'm on page N') and todays_portion, and for_date yesterday", async () => {
    const a = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    expect(text(await action().handler(ctx(a), { next_page: 16 }))).toMatchObject({ toPage: 15 });
    const b = fakeSupabase({ quran_plans: [planRow({ current_page: 11, plan_set_on: "2026-10-04" })] });
    expect(text(await action().handler(ctx(b), { todays_portion: true }))).toMatchObject({ fromPage: 11, toPage: 11 }); // day 1 target (page 10) is already met: at least one page, from the bookmark
    const c = fakeSupabase({ quran_plans: [planRow({ current_page: 11, start_date: "2026-10-01", plan_set_on: "2026-10-01" })] });
    expect(text(await action().handler(ctx(c), { to_page: 15, for_date: "yesterday" }))).toMatchObject({ date: "2026-10-03" });
  });
  it("REJECTS zero or several of to_page / next_page / todays_portion, and a bad for_date", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    await expect(action().handler(ctx(f), {})).rejects.toThrow(/exactly one/);
    await expect(action().handler(ctx(f), { to_page: 15, next_page: 16 })).rejects.toThrow(/exactly one/);
    await expect(action().handler(ctx(f), { to_page: 15, for_date: "tomorrow" })).rejects.toThrow(/for_date/);
    expect(f.tables.quran_sessions).toHaveLength(0);
  });
  it("a core refusal (no plan / paused / behind the bookmark) is a tool input error, never a silent success", async () => {
    await expect(action().handler(ctx(fakeSupabase()), { to_page: 5 })).rejects.toThrow(/Start a Quran plan/);
    const p = fakeSupabase({ quran_plans: [planRow({ status: "paused", paused_on: "2026-10-04" })] });
    await expect(action().handler(ctx(p), { to_page: 5 })).rejects.toThrow(/paused/);
    const b = fakeSupabase({ quran_plans: [planRow({ current_page: 50 })] });
    await expect(action().handler(ctx(b), { to_page: 40 })).rejects.toThrow(/Edit bookmark/);
  });
});
