import { describe, expect, it } from "vitest";
import { editEntry, lastSavedEntry, ledgerBookmark, ledgerGaps, removeEntry, resolveLog, trimLedgerTo, validateLedger, type LedgerContext, type LedgerEntry } from "../ledger";
import { globalAyah } from "../ayah-map";

const CTX: LedgerContext = { startPage: 1, startDate: "2026-10-01", today: "2026-10-10" };
const e = (id: string, date: string, from: number, to: number, seq = 0): LedgerEntry => ({ id, date, from, to, seq });
const BASE = [e("a", "2026-10-02", 1, 10, 1), e("b", "2026-10-04", 11, 20, 2), e("c", "2026-10-06", 21, 30, 3)];

describe("ledger basics", () => {
  it("the bookmark is one past the furthest page, else the start page; gaps are the pages nobody logged", () => {
    expect(ledgerBookmark(BASE, 1)).toBe(31);
    expect(ledgerBookmark([], 22)).toBe(22);
    expect(ledgerGaps(BASE, 1)).toEqual([]);
    expect(ledgerGaps([e("a", "2026-10-02", 1, 5), e("b", "2026-10-04", 9, 12)], 1)).toEqual([{ from: 6, to: 8 }]);
    expect(ledgerGaps([e("a", "2026-10-02", 5, 8)], 1)).toEqual([{ from: 1, to: 4 }]);
  });
  it("validateLedger: overlap, out-of-order days and bad ranges are refused; a clean ledger passes (positive control)", () => {
    expect(validateLedger(BASE, CTX)).toEqual({ ok: true });
    expect(validateLedger([e("a", "2026-10-02", 1, 12), e("b", "2026-10-04", 11, 20)], CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/doesn't fit/) });
    expect(validateLedger([e("a", "2026-10-02", 11, 20), e("b", "2026-10-04", 1, 10)], CTX)).toMatchObject({ ok: false });
    expect(validateLedger([e("a", "2026-10-02", 5, 3)], CTX)).toMatchObject({ ok: false });
    expect(validateLedger([e("a", "2026-10-02", 1, 605)], CTX)).toMatchObject({ ok: false });
    expect(validateLedger([e("a", "2026-09-30", 1, 5)], CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/before your plan/) });
    expect(validateLedger([e("a", "2026-10-11", 1, 5)], CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/hasn't happened/) });
  });
  it("a problem already in an old log never blocks an unrelated edit, but touching it does", () => {
    const old = [e("a", "2026-10-02", 1, 12), e("b", "2026-10-04", 10, 20), e("c", "2026-10-06", 21, 30)];
    expect(editEntry(old, "c", { to: 40 }, CTX)).toMatchObject({ ok: true });
    expect(editEntry(old, "b", { to: 22 }, CTX)).toMatchObject({ ok: false });
  });
  it("same-day entries order by save order", () => {
    const sameDay = [e("x", "2026-10-02", 1, 5, 1), e("y", "2026-10-02", 6, 9, 2)];
    expect(validateLedger(sameDay, CTX)).toEqual({ ok: true });
    expect(validateLedger([e("x", "2026-10-02", 1, 5, 2), e("y", "2026-10-02", 6, 9, 1)], CTX)).toMatchObject({ ok: false });
  });
});

describe("resolveLog: every method, any order", () => {
  it("appends after the reading before that day: pages, finished page, page I'm on", () => {
    expect(resolveLog(BASE, "2026-10-08", { kind: "pages", count: 4 }, CTX)).toMatchObject({ ok: true, entry: { from: 31, to: 34 } });
    expect(resolveLog(BASE, "2026-10-08", { kind: "throughPage", page: 40 }, CTX)).toMatchObject({ ok: true, entry: { from: 31, to: 40 } });
    expect(resolveLog(BASE, "2026-10-08", { kind: "onPage", page: 40 }, CTX)).toMatchObject({ ok: true, entry: { from: 31, to: 39 } });
  });
  it("'I'm on page N' where you already are, or behind, is explained (not silently ignored)", () => {
    expect(resolveLog(BASE, "2026-10-08", { kind: "onPage", page: 31 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/already on page 31/) });
    expect(resolveLog(BASE, "2026-10-08", { kind: "onPage", page: 14 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/already logged/) });
    expect(resolveLog(BASE, "2026-10-08", { kind: "throughPage", page: 14 }, CTX)).toMatchObject({ ok: false });
  });
  it("an ayah on a later page = through the page before it, and is remembered; on the current page it only moves the place", () => {
    const a = globalAyah(2, 142)!; // first ayah of page 22
    expect(resolveLog([e("a", "2026-10-02", 1, 10)], "2026-10-08", { kind: "onAyah", ayah: a }, CTX)).toMatchObject({ ok: true, entry: { from: 11, to: 21 }, restAyah: a, positionOnly: false });
    const here = globalAyah(2, 145)!; // on page 22
    expect(resolveLog([e("a", "2026-10-02", 1, 21)], "2026-10-08", { kind: "onAyah", ayah: here }, CTX)).toMatchObject({ ok: true, positionOnly: true, restAyah: here });
  });
  it("yesterday after today's reading doesn't fit (clear reason), and does once there is room", () => {
    const withToday = [e("a", "2026-10-09", 1, 10, 1), e("b", "2026-10-10", 11, 20, 2)];
    expect(resolveLog(withToday, "2026-10-09", { kind: "pages", count: 3 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/no pages fit|Only/) });
    const room = [e("a", "2026-10-09", 1, 10, 1), e("b", "2026-10-10", 15, 20, 2)];
    expect(resolveLog(room, "2026-10-09", { kind: "pages", count: 4 }, CTX)).toMatchObject({ ok: true, entry: { from: 11, to: 14 } });
    expect(resolveLog(room, "2026-10-09", { kind: "pages", count: 5 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/Only pages 11–14 \(4 pages\) fit/) });
  });
  it("refuses days before the plan, in the future, and past page 604", () => {
    expect(resolveLog(BASE, "2026-09-30", { kind: "pages", count: 1 }, CTX)).toMatchObject({ ok: false });
    expect(resolveLog(BASE, "2026-10-11", { kind: "pages", count: 1 }, CTX)).toMatchObject({ ok: false });
    expect(resolveLog([e("a", "2026-10-02", 1, 600)], "2026-10-08", { kind: "pages", count: 10 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/at most 4/) });
    expect(resolveLog([e("a", "2026-10-02", 1, 604)], "2026-10-08", { kind: "pages", count: 1 }, CTX)).toMatchObject({ ok: false, message: expect.stringMatching(/complete/) });
    expect(resolveLog(BASE, "2026-10-08", { kind: "pages", count: 0 }, CTX)).toMatchObject({ ok: false });
  });
  it("starts at the plan's start page (a plan begun on page 22)", () => {
    const ctx = { ...CTX, startPage: 22 };
    expect(resolveLog([], "2026-10-02", { kind: "pages", count: 3 }, ctx)).toMatchObject({ ok: true, entry: { from: 22, to: 24 } });
    expect(resolveLog([], "2026-10-02", { kind: "throughPage", page: 10 }, ctx)).toMatchObject({ ok: false });
  });
});

describe("edit / remove / trim", () => {
  it("a middle day can shrink (opening a gap) but not grow into its neighbour; end-day edits move the bookmark", () => {
    expect(editEntry(BASE, "b", { to: 18 }, CTX)).toMatchObject({ ok: true });
    expect(editEntry(BASE, "b", { to: 25 }, CTX)).toMatchObject({ ok: false });
    const grown = editEntry(BASE, "c", { to: 45 }, CTX);
    expect(grown.ok && ledgerBookmark(grown.entries, 1)).toBe(46);
    expect(editEntry(BASE, "zzz", { to: 1 }, CTX)).toMatchObject({ ok: false });
  });
  it("shrink then fill: the gap it opened can be logged again, mixing methods", () => {
    const shrunk = editEntry(BASE, "b", { from: 15 }, CTX);
    expect(shrunk.ok).toBe(true);
    if (!shrunk.ok) return;
    expect(ledgerGaps(shrunk.entries, 1)).toEqual([{ from: 11, to: 14 }]);
    expect(resolveLog(shrunk.entries, "2026-10-02", { kind: "pages", count: 4 }, CTX)).toMatchObject({ ok: true, entry: { from: 11, to: 14 } });
    expect(resolveLog(shrunk.entries, "2026-10-03", { kind: "onPage", page: 15 }, CTX)).toMatchObject({ ok: true, entry: { from: 11, to: 14 } });
  });
  it("remove and trim", () => {
    expect(removeEntry(BASE, "b").map((x) => x.id)).toEqual(["a", "c"]);
    expect(trimLedgerTo(BASE, 15).map((x) => [x.id, x.from, x.to])).toEqual([["a", 1, 10], ["b", 11, 14]]);
    expect(lastSavedEntry(BASE)?.id).toBe("c");
    expect(lastSavedEntry([])).toBeNull();
  });
});

describe("properties: any random sequence of logs keeps the ledger valid", () => {
  it("never produces an overlap, and the bookmark equals the furthest page + 1", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    let ledger: LedgerEntry[] = [];
    let seq = 1;
    for (let i = 0; i < 300; i++) {
      const day = `2026-10-${String(1 + rnd(10)).padStart(2, "0")}`;
      const kind = rnd(4);
      const method = kind === 0 ? { kind: "pages" as const, count: 1 + rnd(6) } : kind === 1 ? { kind: "throughPage" as const, page: 1 + rnd(120) } : kind === 2 ? { kind: "onPage" as const, page: 1 + rnd(120) } : { kind: "onAyah" as const, ayah: 1 + rnd(900) };
      const r = resolveLog(ledger, day, method, CTX);
      if (r.ok && !r.positionOnly) ledger = [...ledger, { id: `n${i}`, date: r.entry.date, from: r.entry.from, to: r.entry.to, seq: seq++ }];
      if (i % 11 === 0 && ledger.length > 0) {
        const t = ledger[rnd(ledger.length)];
        const edited = editEntry(ledger, t.id, { to: Math.max(t.from, t.to + rnd(5) - 2) }, CTX);
        if (edited.ok) ledger = edited.entries;
      }
      if (i % 17 === 0 && ledger.length > 0) ledger = removeEntry(ledger, ledger[rnd(ledger.length)].id);
      expect(validateLedger(ledger, CTX)).toEqual({ ok: true });
    }
    expect(ledger.length).toBeGreaterThan(5);
  });
});
