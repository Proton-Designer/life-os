import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getQuranOverviewCore, logQuranReadingCore } from "../plan-core";
import { U, fakeSupabase, planRow } from "./fake-supabase";

// Home's Quran row after midnight (inside the 10 PM -> 1 AM window): it shows the PREVIOUS local date's portion, and "Read"
// must credit exactly that. `{ todaysPortion: true }` cannot: the core computes it from TODAY's date, so with forDate
// "yesterday" it would over-credit (decision recorded in .brain/memory/decisions.md, 2026-10-07).
const TODAY = "2026-10-05";
const YESTERDAY = "2026-10-04";

describe("Home's post-midnight Quran row credits exactly the portion it displays", () => {
  it("logging { toPage: displayed .to } files yesterday's reading from the bookmark to exactly that page", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    const shown = (await getQuranOverviewCore(f.client, U, YESTERDAY)).portion!; // what the row displays at 00:30 on the 5th
    expect(shown.from).toBe(11);

    const res = await logQuranReadingCore(f.client, U, TODAY, { toPage: shown.to }, "yesterday");

    expect(res).toMatchObject({ ok: true, fromPage: shown.from, toPage: shown.to, pagesRead: shown.pages, newCurrentPage: shown.to + 1, date: YESTERDAY });
    expect(f.tables.quran_sessions).toHaveLength(1);
    expect(f.tables.quran_sessions[0]).toMatchObject({ date: YESTERDAY, from_page: shown.from, to_page: shown.to, pages_read: shown.pages });
    expect(f.tables.quran_plans[0].current_page).toBe(shown.to + 1);
  });

  it("CONTRAST (why Home does not use todaysPortion after midnight): { todaysPortion: true } + forDate 'yesterday' credits TODAY's portion, more than the row showed", async () => {
    const shownFor = async (date: string) => (await getQuranOverviewCore(fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] }).client, U, date)).portion!;
    const yesterdayPortion = await shownFor(YESTERDAY);
    const todayPortion = await shownFor(TODAY);
    expect(todayPortion.to).toBeGreaterThan(yesterdayPortion.to); // the premise: the two dates' portions differ

    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 11 })] });
    const res = await logQuranReadingCore(f.client, U, TODAY, { todaysPortion: true }, "yesterday");
    expect(res).toMatchObject({ ok: true, toPage: todayPortion.to, date: YESTERDAY });
    expect((res as { toPage: number }).toPage).not.toBe(yesterdayPortion.to); // over-credit: pages the row never showed
  });

  it("a stale row (the bookmark already moved past the displayed page) is REFUSED with the core's message, nothing is logged", async () => {
    const f = fakeSupabase({ quran_plans: [planRow({ current_page: 41 })] }); // read elsewhere since the page rendered
    const res = await logQuranReadingCore(f.client, U, TODAY, { toPage: 20 }, "yesterday"); // the row still says "through page 20"
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/Edit bookmark/) });
    expect(f.tables.quran_sessions).toHaveLength(0);
    expect(f.tables.quran_plans[0].current_page).toBe(41);
  });
});
