"use client";

import { useEffect, useRef, useTransition } from "react";
import { ListChecks, Timer, type LucideIcon } from "lucide-react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";
import { formatRelativeDuration, formatDurationMagnitude } from "@/lib/date-utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import type { DayRibbonLayout, RibbonSpanState, RibbonActivityKind } from "@/lib/home/day-ribbon";

// An activity block must never be color-only (accessibility, and the dark
// theme's translucent blocks make color alone even harder to tell apart) —
// every block gets an icon plus a short label, never bare color (Ayman,
// overnight session 2026-08-24). class/work/fitness reuse the same glyphs
// their domain uses everywhere else in the app; task/focus have no domain
// icon of their own.
const RIBBON_KIND_ICON: Record<RibbonActivityKind, LucideIcon> = {
  class: DOMAIN_ICON.school,
  work: DOMAIN_ICON.co_op,
  fitness: DOMAIN_ICON.fitness,
  task: ListChecks,
  focus: Timer,
};

const RIBBON_KIND_LABEL: Record<RibbonActivityKind, string> = {
  class: "Class",
  work: "Work",
  fitness: "Fitness",
  task: "Task",
  focus: "Focus",
};

// Second label row is bumped further below the track than the first —
// lib/home/day-ribbon.ts's labelRow decides WHICH row; this just says how
// far down each row sits.
const LABEL_ROW_TOP: Record<0 | 1, string> = {
  0: "calc(50% + 1.25rem)",
  1: "calc(50% + 3rem)",
};

const SPAN_STATE_CLASS: Record<RibbonSpanState, string> = {
  logged: "bg-accent-deen",
  // The live band — the window is currently open and unlogged. Distinct
  // from both "upcoming" (not yet due) and "logged" (already handled): this
  // is the one span that actually needs attention right now.
  pending: "bg-accent-info animate-pulse",
  upcoming: "bg-transparent border border-dashed border-muted-foreground/60",
  missed: "bg-transparent border-2 border-destructive",
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
// (so it's always in view, never clipped on mobile) and always present.
// Priority: a currently-open (pending) window is the most actionable thing
// on the page, so it leads even over "next upcoming".
function statusLine(layout: DayRibbonLayout, timezone: string): string {
  if (layout.nowPosition === "before") {
    const mins = (layout.rangeStart.getTime() - layout.now.getTime()) / 60_000;
    return `${formatDurationMagnitude(mins)} until Fajr at ${formatTime(layout.rangeStart, timezone)}`;
  }
  if (layout.nowPosition === "after") {
    return "Today's day is complete";
  }
  const pending = layout.spans.find((s) => s.state === "pending");
  if (pending) {
    const mins = (pending.windowEnd.getTime() - layout.now.getTime()) / 60_000;
    return `${pending.label} is open now — ${formatDurationMagnitude(mins)} left`;
  }
  const nextUpcoming = [...layout.spans]
    .filter((s) => s.state === "upcoming")
    .sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime())[0];
  if (!nextUpcoming) return "Today's 5 prayers are accounted for";
  const diffMin = (nextUpcoming.windowStart.getTime() - layout.now.getTime()) / 60_000;
  return `Next: ${nextUpcoming.label} ${formatRelativeDuration(diffMin)}`;
}

// The signature element — a day shaped and punctuated by the five prayer
// WINDOWS (spans, not points — Phase 1's whole thesis), plus the overlay of
// today's workout/timed tasks/focus sessions on the same timeline. Markers
// sit at their TRUE computed horizontal position (never evenly spaced —
// that would misrepresent the day's actual shape). Horizontally scrollable
// + auto-centered on "now" at mobile widths, since 5 labels plus times
// genuinely don't fit at 390px.
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
            Today&apos;s workout, tasks, or focus sessions will show up here as your day happens
          </p>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        {/* px-10: spans at the 0%/100% edges still need labels with real
            room to extend past them without clipping. */}
        <div className="min-w-[640px] px-10 py-4" style={{ backgroundImage: DAY_GRADIENT }}>
          <div className="relative">
            {layout.nowPosition === "within" && (
              <div className="absolute inset-y-0 right-0 bg-background/45" style={{ left: `${layout.nowPct}%` }} />
            )}

            <div className="relative h-32">
              <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-border/50" />
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
              {layout.spans.map((s) => (
                <div
                  key={s.name}
                  data-testid={`ribbon-span-${s.name}`}
                  data-state={s.state}
                  className={cn("absolute top-1/2 h-2 -translate-y-1/2 rounded-full", SPAN_STATE_CLASS[s.state])}
                  style={{ left: `${s.startPct}%`, width: `${Math.max(1, s.endPct - s.startPct)}%` }}
                />
              ))}
              {layout.spans.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  disabled={isPending}
                  aria-label={`${s.label}, ${formatTime(s.windowStart, timezone)}–${formatTime(s.windowEnd, timezone)}${s.state === "logged" ? " (logged)" : s.state === "missed" ? " (missed)" : " — mark on time"}`}
                  onClick={() => handleMark(s.name)}
                  className="absolute z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 disabled:opacity-50"
                  style={{ left: `${(s.startPct + s.endPct) / 2}%`, top: LABEL_ROW_TOP[s.labelRow] }}
                >
                  <span className="whitespace-nowrap text-sm font-medium">{s.label}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTime(s.windowStart, timezone)}
                  </span>
                </button>
              ))}
            </div>

            {/* Opus Lead review (2026-08-16): an empty track here rendered
                as a plain light rounded pill spanning near-full-width,
                which reads exactly like an idle horizontal scrollbar —
                there IS nothing to show yet, so don't render inert chrome
                that looks like UI. The invitation line above already
                carries that message. */}
            {layout.blocks.length > 0 && (
              <div className="relative z-10 mt-8 h-7 rounded-full bg-background/30">
                {layout.blocks.map((b, i) => {
                  const Icon = RIBBON_KIND_ICON[b.kind];
                  const kindLabel = RIBBON_KIND_LABEL[b.kind];
                  const blockStyle = {
                    left: `${b.startPct}%`,
                    width: `${Math.max(1, b.endPct - b.startPct)}%`,
                    minWidth: "1.75rem",
                    backgroundColor: `var(${b.colorVar})`,
                  };
                  // A block too narrow for its label keeps the icon (never
                  // color-only) and carries the full label in
                  // aria-label/title instead of clipping into
                  // unreadable text.
                  const content = (
                    <>
                      <Icon className="size-3.5 shrink-0 text-background" aria-hidden />
                      <span className="truncate text-[10px] leading-none font-medium text-background">{b.label}</span>
                    </>
                  );
                  return b.detail ? (
                    <Popover key={i}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${kindLabel}: ${b.detail.title}, ${b.detail.timeRange}`}
                          className="absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-full px-1.5 opacity-80 transition-opacity hover:opacity-100"
                          style={blockStyle}
                        >
                          {content}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="center" className="w-64">
                        <p className="text-sm font-medium">{b.detail.title}</p>
                        <p className="text-xs text-muted-foreground">{b.detail.timeRange}</p>
                        {b.detail.location && <p className="text-xs text-muted-foreground">{b.detail.location}</p>}
                        {b.detail.instructor && <p className="text-xs text-muted-foreground">{b.detail.instructor}</p>}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    // No detail to show (e.g. a focus session) — a plain,
                    // non-interactive block rather than a dead affordance
                    // that looks tappable and does nothing.
                    <div
                      key={i}
                      title={`${kindLabel}: ${b.label}`}
                      className="absolute top-0 flex h-full items-center gap-1 overflow-hidden rounded-full px-1.5 opacity-80"
                      style={blockStyle}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
