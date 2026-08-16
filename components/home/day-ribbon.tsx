"use client";

import { useEffect, useRef, useTransition } from "react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";

const MARKER_STATE_CLASS: Record<string, string> = {
  logged: "bg-accent-deen border-accent-deen",
  upcoming: "bg-transparent border-muted-foreground",
  missed: "bg-transparent border-destructive",
};

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
}

// The signature element — a day shaped and punctuated by the five prayers,
// not a generic analytics chart. Markers sit at their TRUE computed
// horizontal position (never evenly spaced — that would misrepresent the
// day's actual shape). Horizontally scrollable + auto-centered on "now" at
// mobile widths, since 5 labels plus times genuinely don't fit at 390px.
export function DayRibbon({
  layout,
  todayStr,
  timezone,
}: {
  layout: DayRibbonLayout;
  todayStr: string;
  timezone: string;
}) {
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const nowX = (layout.nowPct / 100) * el.scrollWidth;
    el.scrollLeft = Math.max(0, nowX - el.clientWidth / 2);
    // Only meaningful on mount for the current layout — deliberately not
    // re-running on every re-render (e.g. an optimistic prayer mark).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMark(prayerName: string) {
    startTransition(() =>
      markPrayer(todayStr, prayerName as "fajr" | "dhuhr" | "asr" | "maghrib" | "isha", "on_time")
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto">
      {/* px-10: markers at 0%/100% are horizontally centered on their exact
          position via -translate-x-1/2, so the first/last labels need real
          room to extend past the 0%/100% edges without clipping. */}
      <div className="min-w-[640px] px-10">
        <div className="relative h-16">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <div
            className="absolute top-0 bottom-0 z-10 w-px bg-accent-info"
            style={{ left: `${layout.nowPct}%` }}
          >
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] leading-none text-accent-info">
              now
            </span>
          </div>
          {layout.markers.map((m) => (
            <button
              key={m.name}
              type="button"
              disabled={isPending}
              aria-label={`${m.label}, ${formatTime(m.time, timezone)}${m.state === "logged" ? " (logged)" : m.state === "missed" ? " (missed)" : " — mark on time"}`}
              onClick={() => handleMark(m.name)}
              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 disabled:opacity-50"
              style={{ left: `${m.pct}%` }}
            >
              <span className={cn("size-3 rounded-full border-2", MARKER_STATE_CLASS[m.state])} />
              <span className="whitespace-nowrap text-xs font-medium">{m.label}</span>
              <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                {formatTime(m.time, timezone)}
              </span>
            </button>
          ))}
        </div>

        <div className="relative mt-2 h-3 rounded-full bg-muted/40">
          {layout.blocks.length === 0 ? (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
              Nothing logged yet today
            </span>
          ) : (
            layout.blocks.map((b, i) => (
              <div
                key={i}
                title={b.label}
                className="absolute top-0 h-full rounded-full opacity-70"
                style={{
                  left: `${b.startPct}%`,
                  width: `${Math.max(1, b.endPct - b.startPct)}%`,
                  backgroundColor: `var(${b.colorVar})`,
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
