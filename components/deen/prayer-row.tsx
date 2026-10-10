"use client";

import { useId, useState } from "react";
import { useOptimisticItem } from "@/components/deen/use-optimistic-item";
import { ChevronDown } from "lucide-react";
import { markPrayer, unmarkPrayer } from "@/app/(app)/deen/actions";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { SunnahDisclosure, IDLE_AUTO_COLLAPSE_MS } from "@/components/deen/sunnah-disclosure";
import { sunnahForPrayer } from "@/lib/deen/sunnah";
import type { SunnahSlot } from "@/lib/deen/sunnah";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { EffectivePrayerStatus } from "@/lib/deen/prayer-status";
import { cn } from "@/lib/utils";

type ActionableStatus = "on_time" | "qada" | "missed";
// "none" is the optimistic sentinel for "nothing logged" — reached only via
// unmark (pressing an already-active status button again). No fard button
// renders highlighted in this state, matching a freshly-derived
// pending/upcoming/missed row that has no stored status yet.
type OptimisticStatus = ActionableStatus | "none";

function toOptimistic(status: EffectivePrayerStatus): OptimisticStatus {
  return status === "on_time" || status === "qada" || status === "missed" ? status : "none";
}

const STATUS_LABEL: Record<ActionableStatus, string> = {
  on_time: "On-time",
  qada: "Qada",
  missed: "Missed",
};

// Same semantic split as Home's peek-card prayer dots: on-time is a clean
// completion (positive), qada arrived late (warning), missed is negative.
const STATUS_VARIANT: Record<ActionableStatus, BadgeVariant> = {
  on_time: "positive",
  qada: "warning",
  missed: "negative",
};

export function PrayerRow({
  date,
  prayerName,
  label,
  status,
  sunnahCompletions,
}: {
  date: string;
  prayerName: PrayerName;
  label: string;
  status: EffectivePrayerStatus;
  sunnahCompletions: SunnahSlot[];
}) {
  // PERF-1: per-item optimistic state. The tapped status flips at once, writes
  // for THIS prayer run in tap order (absolute state each time, so the stored
  // row ends as the last tap), other prayers/buttons are never disabled, and a
  // failure reverts only this row.
  const item = useOptimisticItem<OptimisticStatus>({
    serverValue: toOptimistic(status),
    queueKey: `prayer:${date}:${prayerName}`,
    write: (next) => (next === "none" ? unmarkPrayer(date, prayerName) : markPrayer(date, prayerName, next)),
  });
  const optimisticStatus = item.value;
  const [expanded, setExpanded] = useState(false);
  // True only while the list was opened BY marking the prayer on time (not by the user's own toggle):
  // that one closes itself after IDLE_AUTO_COLLAPSE_MS if left alone; a hand-opened one stays open.
  const [autoOpened, setAutoOpened] = useState(false);
  const sunnahPanelId = useId();

  const sunnahList = sunnahForPrayer(prayerName);
  const hasSunnah = sunnahList.length > 0;

  // Pressing an already-active status again unmarks it (deletes the stored
  // row) instead of re-writing the same value — the only way to correct a
  // misclick, and every downstream consumer (streaks, qada backlog,
  // consistency grid, Home) reads the same `prayers` rows, so a deleted row
  // reverts them all to the derived pending/upcoming/missed state for free.
  function handleClick(s: ActionableStatus) {
    const isUnmarking = optimisticStatus === s;
    if (!isUnmarking && s === "on_time" && hasSunnah) {
      setAutoOpened(true);
      setExpanded(true);
    }
    item.set(isUnmarking ? "none" : s);
  }

  const completedCount = sunnahList.filter((s) => sunnahCompletions.includes(s.slot)).length;

  return (
    <li className="flex flex-col rounded-lg border border-border/40">
      {/* flex-wrap, no forced-nowrap breakpoint: the label + Upcoming
          indicator + 3 fard buttons + sunnah disclosure don't reliably fit
          on one line — not just at 390px, but also at 1024px on this page,
          since Faith's grid puts this panel in a column narrower than the
          viewport. A real overflow bug at both, caught by the
          layout-overflow spec, not by eyeballing at one width. Wraps
          whenever the row's own available width actually requires it.

          The whole bar (not just the chevron) toggles the sunnah
          disclosure — a plain div with role="button" rather than a real
          <button>, since it wraps the three fard-status buttons and the
          chevron itself, and those need their own click handlers to win
          (stopPropagation), not fire the row's toggle too. */}
      <div
        role={hasSunnah ? "button" : undefined}
        tabIndex={hasSunnah ? 0 : undefined}
        aria-expanded={hasSunnah ? expanded : undefined}
        // Without this, the div's accessible name would flatten every
        // nested button's own label into one run-on string (e.g. "Fajr
        // On-time Qada Missed Sunnah for Fajr") — pin it to just the prayer
        // label instead, matching what's visually read as "the row."
        aria-label={hasSunnah ? label : undefined}
        onClick={
          hasSunnah
            ? () => {
                setAutoOpened(false); // the user took over: never auto-close a list they toggled
                setExpanded((e) => !e);
              }
            : undefined
        }
        onKeyDown={
          hasSunnah
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((x) => !x);
                }
              }
            : undefined
        }
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3",
          hasSunnah && "cursor-pointer"
        )}
      >
        <span className="text-sm font-medium">{label}</span>
        {/* flex-wrap + min-w-0: the outer row wraps, but this group did not,
            so its min-content (Upcoming + three status badges + the sunnah
            counter) held the row open and pushed /deen into horizontal
            scroll at 320px. Pre-existing; surfaced when 320 joined
            layout-overflow.spec.ts's breakpoints (2026-08-27). */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {status === "upcoming" && <span className="text-xs text-muted-foreground">Upcoming</span>}
          {(["on_time", "qada", "missed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick(s);
              }}
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <Badge variant={optimisticStatus === s ? STATUS_VARIANT[s] : "neutral"}>
                {STATUS_LABEL[s]}
              </Badge>
            </button>
          ))}
          {hasSunnah && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={sunnahPanelId}
              aria-label={`Sunnah for ${label}`}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <span className="font-mono tabular-nums">
                {completedCount}/{sunnahList.length}
              </span>
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {item.error && (
        <p role="alert" className="px-4 pb-2 text-xs text-destructive">
          Couldn&apos;t save {label}: {item.error}
        </p>
      )}
      {expanded && hasSunnah && (
        <SunnahDisclosure
          date={date}
          prayerName={prayerName}
          sunnahCompletions={sunnahCompletions}
          panelId={sunnahPanelId}
          idleCollapseMs={autoOpened ? IDLE_AUTO_COLLAPSE_MS : undefined}
          onCollapse={() => {
            setAutoOpened(false);
            setExpanded(false);
          }}
        />
      )}
    </li>
  );
}
