"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WeekCalendarView, type WeekCalendarData } from "@/components/calendar/week-calendar-view";
import { localDateString, dayOfWeekFromDateString } from "@/lib/date-utils";

type SaveGoalAction = (headline: string, milestones: string[], quranPageTarget?: number) => Promise<void>;

// Module-scope, not component-state: Topbar/CalendarDialogTrigger remounts on
// client-side navigation between pages (measured — a fresh open after
// navigating away re-triggers the Server Action even though `open` was never
// left true), so a useState-only cache loses everything on every nav. This
// snapshot is a browser-tab-lifetime singleton per JS module instance; it
// survives remounts and is shared by every mounted trigger.
//
// Keyed by account identity (email), NOT a single shared slot. A
// module-scope cache outlives the signed-in user: `signOut` (app/(app)/
// actions.ts) ends in a Server Action `redirect()`, which is a client-side
// navigation, not a document load — this module instance, and whatever it
// holds, survives sign-out and the next sign-in. Sign out, sign in as a
// different account, open the calendar: without the key, this would paint
// the PREVIOUS account's week (schedule, tasks, goals). On this machine the
// two accounts in play are SEED and Ayman's real one. Fail closed: any key
// mismatch is treated as a cache miss, never as data to paint.
type CacheEntry = { key: string; data: WeekCalendarData };
let cachedEntry: CacheEntry | null = null;
let inflight: { key: string; generation: number; promise: Promise<WeekCalendarData> } | null = null;
// Bumped on every invalidation (a save). `cachedData = null` alone does NOT
// defeat an already-in-flight fetch — fetchAndCache would just hand back the
// pre-invalidation promise and its pre-save payload. Capturing the
// generation when a fetch starts and dropping its result if the generation
// has since moved is what actually invalidates it.
let generation = 0;

function fetchAndCache(getWeekCalendar: () => Promise<WeekCalendarData>, key: string): Promise<WeekCalendarData> {
  // The generation check is load-bearing, not just the key: an invalidation
  // (a save) bumps `generation` but can't cancel an already-in-flight
  // request. Without this check, a `load()` called right after
  // `invalidateCalendarCache()` would still see `inflight.key === key` and
  // hand back that same stale, pre-invalidation promise — exactly
  // defeating the invalidation it was meant to force.
  if (inflight && inflight.key === key && inflight.generation === generation) return inflight.promise;
  const startedAtGeneration = generation;
  const promise = getWeekCalendar().then((fresh) => {
    if (startedAtGeneration === generation) cachedEntry = { key, data: fresh };
    return fresh;
  });
  inflight = { key, generation: startedAtGeneration, promise };
  promise.finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  return promise;
}

function invalidateCalendarCache(): void {
  generation += 1;
  cachedEntry = null;
}

/**
 * The topbar's calendar button, converted from a `<Link href="/calendar">`
 * (a full server navigation — Ayman: "it takes like 2 seconds to load up a
 * new screen") into an instant popup. Ayman then reported it *still* takes
 * 1-2s "every time" — root-caused to two compounding issues, both fixed here:
 * (1) the old per-mount useState cache didn't survive a client-side nav
 * remounting this component, so nearly every real open was a cold fetch;
 * (2) even a cold fetch showed a spinner instead of painting anything, so
 * the felt latency was the full round trip every time it mattered.
 *
 * Fix: a module-scope, identity-keyed cache (see above) survives remounts,
 * and every open is stale-while-revalidate — paint whatever's cached
 * instantly (even if stale), silently refetch behind it, and only show the
 * spinner on a genuine cold start with nothing cached for this account yet.
 * The refetch-behind-stale-paint is load-bearing for correctness, not just
 * a freshness nicety: schedule events, tasks, and goals all flow through
 * this snapshot and can change from other screens (school classes, kill
 * list, weekly goals) between opens, so every open re-asks the server even
 * though it never blocks the paint. A pointerenter/pointerdown prefetch on
 * the trigger button warms the cache before the click even lands (pointerdown
 * fires ~100ms before click), and an idle-time prefetch after mount warms it
 * for a user who opens the dialog without hovering first (e.g. keyboard/
 * touch). Deliberately NOT prefetched from the layout's server render — that
 * would tax every page render for a dialog most renders never open (spec
 * item C) — this only prefetches once a trigger has actually mounted.
 *
 * `getWeekCalendar`/`onSaveDeen`/`onSaveBusiness` are Server Action
 * references (the first unbound, the latter two `.bind(null, domain)`)
 * threaded down from app/(app)/layout.tsx through AppShell/AppShellChrome/
 * Topbar — passed through unchanged at every layer, never rewrapped in a
 * plain arrow function crossing a Server→Client boundary (AGENTS.md).
 */
export function CalendarDialogTrigger({
  accountKey,
  timezone,
  getWeekCalendar,
  onSaveDeen,
  onSaveBusiness,
}: {
  /** The signed-in account's email — the cache key. See the module-scope
   * comment above for why this can't be a single shared slot. */
  accountKey: string;
  /** The profile's own timezone, not the browser's — see todayDayOfWeek below. */
  timezone: string;
  getWeekCalendar: () => Promise<WeekCalendarData>;
  onSaveDeen: SaveGoalAction;
  onSaveBusiness: SaveGoalAction;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WeekCalendarData | null>(() =>
    cachedEntry?.key === accountKey ? cachedEntry.data : null
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const getWeekCalendarRef = useRef(getWeekCalendar);
  getWeekCalendarRef.current = getWeekCalendar;

  // Defense in depth: if `accountKey` ever changes on an already-mounted
  // trigger (no remount in between), drop any cross-account data on sight
  // rather than trust the stale render. The primary guard is still the key
  // check on every read/write above and below.
  useEffect(() => {
    if (cachedEntry && cachedEntry.key !== accountKey) {
      invalidateCalendarCache();
    }
    setData(cachedEntry?.key === accountKey ? cachedEntry.data : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  async function load() {
    const hadData = cachedEntry?.key === accountKey;
    if (!hadData) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      const fresh = await fetchAndCache(getWeekCalendarRef.current, accountKey);
      setData(fresh);
    } catch {
      // A failed background revalidation shouldn't yank away a working
      // stale view — only surface the error state when there was nothing
      // to fall back to.
      if (!hadData) setLoadError(true);
    } finally {
      if (!hadData) setLoading(false);
    }
  }

  function prefetch() {
    if (cachedEntry?.key === accountKey || inflight?.key === accountKey) return;
    void load();
  }

  useEffect(() => {
    if (cachedEntry?.key === accountKey) return;
    // Idle-time warm for opens that never hover first (touch, keyboard).
    const win = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(prefetch);
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const id = setTimeout(prefetch, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Stale-while-revalidate: paint whatever's cached (possibly stale)
    // immediately via the lazy useState init above, then always refetch
    // silently behind it so a change made elsewhere (a new class added on
    // /school, say) shows up next open instead of being cached forever.
    if (next) void load();
  }

  // These wrappers MUST `await load()` before returning: GoalSlot's own
  // onSave handler only calls `setOpen(false)` (closing the nested goal-edit
  // dialog) after this promise resolves, so the refetch completes and
  // `data` is fresh before the user ever sees the inner dialog close.
  // Making this fire-and-forget (dropping the `await` or returning early)
  // reintroduces a real bug: the calendar popup behind the closed dialog
  // would keep showing the pre-edit headline until closed and reopened.
  // `invalidateCalendarCache()` bumps the generation counter — not just
  // `cachedEntry = null` — so an already-in-flight prefetch/revalidation
  // (handleOpenChange fires `load()` on every open, so open-then-edit races
  // this) can't win the race and write its pre-save payload back in;
  // `load()` below always starts a fresh fetch and repopulates the cache.
  async function handleSaveDeen(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSaveDeen(headline, milestones, quranPageTarget);
    invalidateCalendarCache();
    await load();
  }

  async function handleSaveBusiness(headline: string, milestones: string[], quranPageTarget?: number) {
    await onSaveBusiness(headline, milestones, quranPageTarget);
    invalidateCalendarCache();
    await load();
  }

  // The profile's timezone, not the browser's — `/calendar/page.tsx` (the
  // other home for the same WeekCalendarView) computes this off the profile
  // for the same reason (AGENTS.md's calendar-date rule): a raw
  // `new Date().getDay()` is only right when the device and the profile
  // timezone happen to agree.
  const todayDayOfWeek = dayOfWeekFromDateString(localDateString(new Date(), timezone));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Open calendar"
          onPointerEnter={prefetch}
          onPointerDown={prefetch}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <CalendarDays className="size-5" />
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-y-auto sm:max-w-4xl"
        aria-describedby={undefined}
      >
        <DialogTitle>This week</DialogTitle>
        {loading && !data && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
        {!loading && loadError && !data && (
          <p className="py-12 text-center text-sm text-muted-foreground">Couldn&apos;t load your calendar. Try again.</p>
        )}
        {data && (
          <WeekCalendarView
            data={data}
            todayDayOfWeek={todayDayOfWeek}
            onSaveDeen={handleSaveDeen}
            onSaveBusiness={handleSaveBusiness}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
