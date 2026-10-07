"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toggleItem } from "@/app/(app)/actions";
import { QuranNowRow } from "@/components/home/quran-now-row";
import { useHomeRefresh } from "@/components/home/use-home-refresh";
import { SunnahDisclosure } from "@/components/deen/sunnah-disclosure";
import { RowShell } from "@/components/shared/row-shell";
import { useRowOverlay } from "@/components/shared/use-row-overlay";
import { Button } from "@/components/ui/button";
import { formatClock12, localClockHHMM } from "@/lib/date-utils";
import { currentPrayer } from "@/lib/home/current-prayer";
import { quranReminderState } from "@/lib/home/quran-reminder";
import type { PriorityItem } from "@/lib/home/types";
import type { HomeNowItem } from "@/lib/quran/surfaces";
import { sunnahForPrayer } from "@/lib/deen/sunnah";
import type { PrayerName } from "@/lib/prayer-times/windows";
import { cn } from "@/lib/utils";

/**
 * "Right now" (Deen Mode only): the top of Home's Today panel, where the Quran row used to sit all day.
 *   PRAYER  only the ONE prayer whose own window contains now and that is not yet prayed (lib/home/current-prayer.ts):
 *           its name, "until 6:42 PM", a one-tap "Prayed" (the same toggleItem the prayer row always used) and the
 *           sunnah disclosure. It disappears once prayed or when the window ends. Never two at once.
 *   QURAN   today's portion, ONLY inside the person's Quran reminder window (Settings; default 10 PM - 1 AM) and only if
 *           that portion is not read yet. Outside the window it is not on Home (the Faith page still has it).
 * Both can show at once (e.g. Isha + Quran at 10:30 PM): prayer first. Nothing to show renders nothing (no empty frame).
 *
 * The page is server-rendered with `now`; this re-evaluates the same pure helpers from the props once a minute (and
 * immediately on mount, because a Router-Cache-served Home payload can be an hour stale), so a window closing on an
 * open tab takes the row away without a reload. A window OPENING needs the portion's data, so it waits for the next
 * server render (the existing refresh / visibility mechanisms).
 */
const TICK_MS = 60 * 1000;

type PrayerRow = { id: string; completedAtIso: null; item: PriorityItem };

export function RightNowStrip({
  prayers,
  quran,
  nowIso,
  timezone,
  date,
}: {
  /** Today's pending prayer items (getPriorityItems, actionType "toggle_prayer"). */
  prayers: PriorityItem[];
  /** The portion the server resolved for the window it was in when it rendered (null: nothing to show then), with that window. */
  quran: { item: HomeNowItem; forDate: "today" | "yesterday"; start: string | null; end: string | null } | null;
  nowIso: string;
  timezone: string;
  /** Today's local date (prayer sunnah rows are keyed by it). */
  date: string;
}) {
  const scheduleRefresh = useHomeRefresh();
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const rows: PrayerRow[] = prayers.map((item) => ({ id: item.id, completedAtIso: null, item }));
  const overlay = useRowOverlay(rows);
  const [struck, setStruck] = useState<ReadonlySet<string>>(new Set());
  const [sunnahOpen, setSunnahOpen] = useState(false);

  // A prayer that has been ticked and has finished leaving is no longer a candidate (it is "gone", i.e. completed locally).
  const stillPending = overlay.view.filter((r) => !r.completedAtIso).map((r) => r.item);
  const prayer = currentPrayer(stillPending, now);

  const state = quran ? quranReminderState(localClockHHMM(now, timezone), quran.start, quran.end) : null;
  const showQuran = !!quran && !!state && state.forDate === quran.forDate && !quran.item.done;

  if (!prayer && !showQuran) return null;

  function prayed(item: PriorityItem) {
    setStruck((s) => new Set(s).add(item.id));
    overlay
      .completeRow(item.id, async () => {
        try {
          await toggleItem(item);
        } finally {
          scheduleRefresh();
        }
      })
      .catch(() =>
        setStruck((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        }),
      );
  }

  const hasSunnah = !!prayer && sunnahForPrayer(prayer.actionRefId as PrayerName).length > 0;
  const prayerStruck = !!prayer && (struck.has(prayer.id) || overlay.exitingIds.has(prayer.id));

  return (
    <section aria-label="Right now" className="flex flex-col gap-1.5" data-testid="right-now-strip">
      <h3 className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Right now</h3>
      {prayer ? (
        <ul>
          <RowShell exiting={overlay.exitingIds.has(prayer.id)} data-testid="right-now-prayer">
            <div className="flex flex-col gap-1 rounded-lg border border-accent-deen/30 bg-accent-deen/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium transition-colors duration-300", prayerStruck && "text-muted-foreground line-through decoration-accent-business")}>{prayer.title}</p>
                  {prayer.windowEndAt ? <p className="text-xs text-muted-foreground">until {formatClock12(prayer.windowEndAt, timezone)}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hasSunnah ? (
                    <button
                      type="button"
                      aria-expanded={sunnahOpen}
                      aria-label={`Sunnah for ${prayer.title}`}
                      onClick={() => setSunnahOpen((v) => !v)}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40"
                    >
                      <span className="font-mono tabular-nums">
                        {(prayer.sunnahCompletions ?? []).length}/{sunnahForPrayer(prayer.actionRefId as PrayerName).length}
                      </span>
                      <ChevronDown className={cn("size-3.5 transition-transform", sunnahOpen && "rotate-180")} aria-hidden />
                    </button>
                  ) : null}
                  {prayerStruck ? (
                    <span className="flex items-center gap-1 text-xs text-accent-deen" role="status">
                      <Check className="size-4" aria-hidden />
                      Prayed
                    </span>
                  ) : (
                    <Button type="button" size="sm" onClick={() => prayed(prayer)} data-testid="right-now-prayed">
                      Prayed
                    </Button>
                  )}
                </div>
              </div>
              {sunnahOpen && hasSunnah ? (
                <SunnahDisclosure date={prayer.date || date} prayerName={prayer.actionRefId as PrayerName} sunnahCompletions={prayer.sunnahCompletions ?? []} onCollapse={() => setSunnahOpen(false)} />
              ) : null}
            </div>
          </RowShell>
        </ul>
      ) : null}
      {showQuran && quran ? <QuranNowRow item={quran.item} forDate={quran.forDate} onStale={scheduleRefresh} /> : null}
    </section>
  );
}
