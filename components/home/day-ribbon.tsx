"use client";

import { useEffect, useRef, useTransition } from "react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";
import { formatRelativeDuration, formatDurationMagnitude } from "@/lib/date-utils";
import type { DayRibbonLayout } from "@/lib/home/day-ribbon";

const MARKER_STATE_CLASS: Record<string, string> = {
  logged: "bg-accent-deen border-accent-deen",
  upcoming: "bg-transparent border-muted-foreground",
  missed: "bg-transparent border-destructive",
};

// Night -> dawn -> midday -> dusk -> night, so the long Fajr-Dhuhr and
// Asr-Isha stretches carry information (where you are in the day) instead
// of reading as absence. Built from existing tokens, not new colors:
// --accent-info bookends the calm dawn/night ends, --accent-deen carries
// warm midday, --glow-oxblood (the app's own signature ember color) sits
// at the Maghrib stretch.
const DAY_GRADIENT = [
  "linear-gradient(to right,",
  "color-mix(in oklch, var(--accent-info) 14%, transparent) 0%,",
  "color-mix(in oklch, var(--accent-deen) 16%, transparent) 42%,",
  "color-mix(in oklch, var(--accent-deen) 20%, transparent) 55%,",
  "color-mix(in oklch, var(--glow-oxblood) 55%, transparent) 78%,",
  "color-mix(in oklch, var(--accent-info) 14%, transparent) 100%)",
].join(" ");

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
}

// The ribbon's headline — rendered OUTSIDE the horizontally-scrolling track
// (so it's always in view, never clipped on mobile) and always present
// (not just for the empty-day case) so the ribbon carries real textual
// weight, per the "should feel like the page's spine" review note. Also
// where before-Fajr/after-Isha get an explicit, real label instead of a
// silently-clamped indicator that reads as "now is Fajr".
function statusLine(layout: DayRibbonLayout, timezone: string): string {
  if (layout.nowPosition === "before") {
    const mins = (layout.rangeStart.getTime() - layout.now.getTime()) / 60_000;
    return `${formatDurationMagnitude(mins)} until Fajr at ${formatTime(layout.rangeStart, timezone)}`;
  }
  if (layout.nowPosition === "after") {
    const mins = (layout.now.getTime() - layout.rangeEnd.getTime()) / 60_000;
    return `${formatDurationMagnitude(mins)} since Isha — today's day is complete`;
  }
  const next = layout.markers.find((m) => m.state === "upcoming");
  if (!next) return "All 5 prayers logged for today";
  const diffMin = (next.time.getTime() - layout.now.getTime()) / 60_000;
  return `Next: ${next.label} ${formatRelativeDuration(diffMin)}`;
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
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-base font-medium">{statusLine(layout, timezone)}</p>
        {layout.blocks.length === 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Check-ins and Lock-In sessions will show up here as your day happens
          </p>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        {/* px-10: markers at 0%/100% are horizontally centered on their exact
            position via -translate-x-1/2, so the first/last labels need real
            room to extend past the 0%/100% edges without clipping. */}
        <div className="min-w-[640px] px-10 py-4" style={{ backgroundImage: DAY_GRADIENT }}>
          <div className="relative">
            {layout.nowPosition === "within" && (
              <div className="absolute inset-y-0 right-0 bg-background/45" style={{ left: `${layout.nowPct}%` }} />
            )}

            <div className="relative h-24">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              {layout.nowPosition === "within" && (
                <div
                  className="absolute top-0 bottom-0 z-10 w-px bg-accent-info"
                  style={{ left: `${layout.nowPct}%` }}
                >
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] leading-none whitespace-nowrap text-accent-info">
                    now
                  </span>
                </div>
              )}
              {layout.markers.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  disabled={isPending}
                  aria-label={`${m.label}, ${formatTime(m.time, timezone)}${m.state === "logged" ? " (logged)" : m.state === "missed" ? " (missed)" : " — mark on time"}`}
                  onClick={() => handleMark(m.name)}
                  className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 disabled:opacity-50"
                  style={{ left: `${m.pct}%` }}
                >
                  <span className={cn("size-4 rounded-full border-2", MARKER_STATE_CLASS[m.state])} />
                  <span className="whitespace-nowrap text-sm font-medium">{m.label}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTime(m.time, timezone)}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative z-10 mt-3 h-4 rounded-full bg-background/30">
              {layout.blocks.map((b, i) => (
                <div
                  key={i}
                  title={b.label}
                  className="absolute top-0 h-full rounded-full opacity-80"
                  style={{
                    left: `${b.startPct}%`,
                    width: `${Math.max(1, b.endPct - b.startPct)}%`,
                    backgroundColor: `var(${b.colorVar})`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
