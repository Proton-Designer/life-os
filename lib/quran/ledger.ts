import { formatShortDate } from "@/lib/date-utils";
import { TOTAL_PAGES } from "@/lib/quran/page-map";
import { pageOfAyah } from "@/lib/quran/ayah-map";

/**
 * QURAN-03: the reading LEDGER, the one source of truth for where a khatm stands.
 *
 * A khatm's reading log is a list of entries, each "on this day I read pages from..to". The ledger is consistent when, in
 * day order (same day: the order they were saved), every entry ends before the next one begins: pages never overlap and
 * never run backwards in time. Gaps are allowed (pages not logged yet, e.g. a day opened up by editing) and are shown so
 * they can be filled. The BOOKMARK is derived, never typed: the page after the furthest page ever logged (or the plan's
 * start page), so any mix of logging methods, in any order, always leaves one consistent position.
 *
 * Everything here is pure (no I/O, no clock): the server validates every change with it and the client previews with the
 * same code, so what the card says will fit is exactly what the server accepts. Client-safe.
 */

export type LedgerEntry = {
  id: string;
  /** YYYY-MM-DD, the local day the reading is filed under. */
  date: string;
  from: number;
  to: number;
  /** Save order (created_at, ms): orders entries that share a day. */
  seq: number;
};

/** The placeholder id of an entry that is being added. */
export const NEW_ENTRY_ID = "__new__";
const NEW_SEQ = Number.MAX_SAFE_INTEGER;

export type LedgerContext = { startPage: number; startDate: string; today: string };

export type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

/** How a reading is described: any of these resolves to a span of whole pages. */
export type LogMethod =
  | { kind: "pages"; count: number } // "I read 3 pages"
  | { kind: "throughPage"; page: number } // "I finished page 20"
  | { kind: "onPage"; page: number } // "I'm on page 21" (= finished 20)
  | { kind: "onAyah"; ayah: number }; // "I'm on 2:142" (global ayah number; = finished the page before it)

const fmt = (d: string) => formatShortDate(d);
const pagesText = (from: number, to: number) => (from === to ? `page ${from}` : `pages ${from}–${to}`);

export function sortLedger(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
}

/** The next page to read: one past the furthest page logged, else the plan's start page. 605 = the khatm is finished. */
export function ledgerBookmark(entries: readonly LedgerEntry[], startPage: number): number {
  let max = startPage - 1;
  for (const e of entries) if (e.to > max) max = e.to;
  return max + 1;
}

export type PageGap = { from: number; to: number };

/** Pages between the start page and the bookmark that no entry covers (to be filled in from History). */
export function ledgerGaps(entries: readonly LedgerEntry[], startPage: number): PageGap[] {
  const gaps: PageGap[] = [];
  let next = startPage;
  for (const e of [...entries].sort((a, b) => a.from - b.from)) {
    if (e.from > next) gaps.push({ from: next, to: e.from - 1 });
    if (e.to + 1 > next) next = e.to + 1;
  }
  return gaps;
}

/**
 * Checks the ledger. Only pairs that involve an entry in `touched` are compared (default: every entry), so a problem
 * that was already in an old log never blocks an unrelated edit, while a change can never create a new one.
 */
export function validateLedger(entries: readonly LedgerEntry[], ctx: LedgerContext, touched?: ReadonlySet<string>): { ok: true } | Fail {
  const sorted = sortLedger(entries);
  const isTouched = (e: LedgerEntry) => !touched || touched.has(e.id);
  for (const e of sorted) {
    if (!isTouched(e)) continue;
    if (!Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < 1 || e.to > TOTAL_PAGES) return fail(`Pages must be between 1 and ${TOTAL_PAGES}.`);
    if (e.to < e.from) return fail("The last page can't be before the first page.");
    if (e.from < ctx.startPage) return fail(`Your plan starts at page ${ctx.startPage}, so reading can't begin before it.`);
    if (e.date < ctx.startDate) return fail(`That day is before your plan started (${fmt(ctx.startDate)}).`);
    if (e.date > ctx.today) return fail("That day hasn't happened yet.");
  }
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!isTouched(a) && !isTouched(b)) continue;
    if (a.to >= b.from) {
      return fail(
        `That doesn't fit: ${fmt(a.date)} covers ${pagesText(a.from, a.to)}, but ${fmt(b.date)} starts at page ${b.from}. Days have to follow each other in page order with no overlap, so change one of them first.`
      );
    }
  }
  return { ok: true };
}

/** The first page a reading on `date` can start at, and the last page it can reach (the next logged day's first page - 1). */
export function logPageRange(entries: readonly LedgerEntry[], date: string, ctx: LedgerContext): { from: number; limit: number } {
  const sorted = sortLedger(entries);
  const before = sorted.filter((e) => e.date <= date);
  const after = sorted.filter((e) => e.date > date);
  const from = Math.max(ctx.startPage, before.length > 0 ? before[before.length - 1].to + 1 : ctx.startPage);
  return { from, limit: after.length > 0 ? after[0].from - 1 : TOTAL_PAGES };
}

export type ResolvedLog = {
  ok: true;
  entry: { date: string; from: number; to: number };
  /** Set by "I'm on an ayah": the ayah to remember as the exact place (only when it is the newest position). */
  restAyah: number | null;
  /** The ayah is inside the page the bookmark is already on: no whole page was finished, only the exact place moves. */
  positionOnly: boolean;
};

/**
 * Turns "I read 3 pages" / "I finished page 20" / "I'm on page 21" / "I'm on 2:142" for a day into the span it covers,
 * placing it right after the reading before that day, and refuses anything that would not fit before the next day.
 */
export function resolveLog(entries: readonly LedgerEntry[], date: string, method: LogMethod, ctx: LedgerContext): ResolvedLog | Fail {
  if (date < ctx.startDate) return fail(`That day is before your plan started (${fmt(ctx.startDate)}).`);
  if (date > ctx.today) return fail("That day hasn't happened yet.");
  const sorted = sortLedger(entries);
  const before = sorted.filter((e) => e.date <= date);
  const after = sorted.filter((e) => e.date > date);
  const prev = before.length > 0 ? before[before.length - 1] : null;
  const from = Math.max(ctx.startPage, prev ? prev.to + 1 : ctx.startPage);
  if (from > TOTAL_PAGES) return fail("This khatm is already complete.");
  const limit = after.length > 0 ? after[0].from - 1 : TOTAL_PAGES;

  const alreadyCovered = (page: number): Fail =>
    prev ? fail(`Page ${page} is already logged: reading on ${fmt(prev.date)} reaches page ${prev.to}. To change it, edit that day in History.`) : fail(`Your plan starts at page ${ctx.startPage}.`);

  let to: number;
  let restAyah: number | null = null;
  let positionOnly = false;
  switch (method.kind) {
    case "pages": {
      if (!Number.isInteger(method.count) || method.count < 1) return fail("Enter at least 1 page.");
      to = from + method.count - 1;
      break;
    }
    case "throughPage": {
      if (!Number.isInteger(method.page) || method.page < 1 || method.page > TOTAL_PAGES) return fail(`Page must be between 1 and ${TOTAL_PAGES}.`);
      if (method.page < from) return alreadyCovered(method.page);
      to = method.page;
      break;
    }
    case "onPage": {
      if (!Number.isInteger(method.page) || method.page < 1 || method.page > TOTAL_PAGES) return fail(`Page must be between 1 and ${TOTAL_PAGES}.`);
      if (method.page === from) return fail(`You're already on page ${method.page}.`);
      if (method.page < from) return alreadyCovered(method.page);
      to = method.page - 1;
      break;
    }
    case "onAyah": {
      const page = pageOfAyah(method.ayah);
      if (page < from) return alreadyCovered(page);
      restAyah = method.ayah;
      if (page === from) {
        if (after.length > 0) return fail(`That ayah is on page ${page}, where ${fmt(date)}'s reading would already start, so no whole page is added there.`);
        positionOnly = true;
        to = from - 1;
      } else {
        to = page - 1;
      }
      break;
    }
  }

  if (!positionOnly) {
    if (to > limit) {
      if (after.length > 0) {
        const room = limit - from + 1;
        return fail(
          room > 0
            ? `Only ${pagesText(from, limit)} (${room} page${room === 1 ? "" : "s"}) fit on ${fmt(date)}: ${fmt(after[0].date)} already starts at page ${after[0].from}. Edit that day in History first if that's wrong.`
            : `${fmt(after[0].date)} already starts at page ${after[0].from}, so no pages fit on ${fmt(date)}. Edit that day in History first if that's wrong.`
        );
      }
      return fail(`The Qur'an has ${TOTAL_PAGES} pages; from page ${from} you can log at most ${TOTAL_PAGES - from + 1}.`);
    }
    const check = validateLedger([...entries, { id: NEW_ENTRY_ID, date, from, to, seq: NEW_SEQ }], ctx, new Set([NEW_ENTRY_ID]));
    if (!check.ok) return check;
  }
  // The exact ayah only means something while it is the newest position.
  if (!positionOnly && after.length > 0) restAyah = null;
  return { ok: true, entry: { date, from, to }, restAyah, positionOnly };
}

export type EntryPatch = { date?: string; from?: number; to?: number };

/** The ledger with one entry changed, or why it can't be: the neighbours (by day and by page) must still line up. */
export function editEntry(entries: readonly LedgerEntry[], id: string, patch: EntryPatch, ctx: LedgerContext): { ok: true; entries: LedgerEntry[] } | Fail {
  const target = entries.find((e) => e.id === id);
  if (!target) return fail("That entry no longer exists. Refresh and try again.");
  const next: LedgerEntry = { ...target, ...(patch.date !== undefined ? { date: patch.date } : {}), ...(patch.from !== undefined ? { from: patch.from } : {}), ...(patch.to !== undefined ? { to: patch.to } : {}) };
  const out = entries.map((e) => (e.id === id ? next : e));
  const check = validateLedger(out, ctx, new Set([id]));
  return check.ok ? { ok: true, entries: out } : check;
}

export function removeEntry(entries: readonly LedgerEntry[], id: string): LedgerEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Moves the bookmark BACK to `page`: entries wholly at/after it are dropped and the one straddling it is cut short. */
export function trimLedgerTo(entries: readonly LedgerEntry[], nextPage: number): LedgerEntry[] {
  return entries.filter((e) => e.from < nextPage).map((e) => (e.to >= nextPage ? { ...e, to: nextPage - 1 } : e));
}

/** The entry added last (highest save order), for "Undo last log". */
export function lastSavedEntry(entries: readonly LedgerEntry[]): LedgerEntry | null {
  let best: LedgerEntry | null = null;
  for (const e of entries) if (!best || e.seq > best.seq) best = e;
  return best;
}
