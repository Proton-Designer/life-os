"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { markPrayer, toggleSunnah, unmarkPrayer } from "@/app/(app)/deen/actions";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { sunnahForPrayer, type SunnahDefinition, type SunnahSlot } from "@/lib/deen/sunnah";
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

const SLOT_LABEL: Record<SunnahSlot, string> = {
  before: "Before",
  after: "After",
  witr: "Witr",
};

const EMPHASIS_LABEL: Record<SunnahDefinition["emphasis"], string> = {
  "mu'akkadah": "Mu'akkadah",
  "ghayr mu'akkadah": "Ghayr mu'akkadah",
  witr: "Witr",
};

function SunnahRow({
  date,
  prayerName,
  def,
  completed,
}: {
  date: string;
  prayerName: PrayerName;
  def: SunnahDefinition;
  completed: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    completed,
    (_state, next: boolean) => next
  );

  function handleClick() {
    startTransition(async () => {
      setOptimisticCompleted(!optimisticCompleted);
      await toggleSunnah(date, prayerName, def.slot);
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      aria-pressed={optimisticCompleted}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "size-4 shrink-0 rounded-full border",
            optimisticCompleted ? "border-accent-deen bg-accent-deen" : "border-border"
          )}
        />
        {SLOT_LABEL[def.slot]} &middot; {def.rakah} rak&apos;ah
      </span>
      <span className="text-xs text-muted-foreground">{EMPHASIS_LABEL[def.emphasis]}</span>
    </button>
  );
}

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
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    toOptimistic(status),
    (_state, next: OptimisticStatus) => next
  );
  const [expanded, setExpanded] = useState(false);
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
    // Outside the transition, not inside its async callback: a plain
    // useState update made inside startTransition's body is itself treated
    // as a (deferred) transition update, unlike useOptimistic's special-cased
    // synchronous behavior — it wouldn't reliably be visible by the time the
    // caller's next assertion (or the user's eyes) checks it.
    if (!isUnmarking && s === "on_time" && hasSunnah) setExpanded(true);
    startTransition(async () => {
      if (isUnmarking) {
        setOptimisticStatus("none");
        await unmarkPrayer(date, prayerName);
        return;
      }
      setOptimisticStatus(s);
      await markPrayer(date, prayerName, s);
    });
  }

  const completedCount = sunnahList.filter((s) => sunnahCompletions.includes(s.slot)).length;

  return (
    <li className="flex flex-col rounded-lg border border-border/40">
      {/* flex-wrap, no forced-nowrap breakpoint: the label + Upcoming
          indicator + 3 fard buttons + sunnah disclosure don't reliably fit
          on one line — not just at 390px, but also at 1024px on this page,
          since Deen's grid puts this panel in a column narrower than the
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
        onClick={hasSunnah ? () => setExpanded((e) => !e) : undefined}
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
        <div className="flex items-center gap-2">
          {status === "upcoming" && <span className="text-xs text-muted-foreground">Upcoming</span>}
          {(["on_time", "qada", "missed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleClick(s);
              }}
              className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
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
      {expanded && hasSunnah && (
        <div id={sunnahPanelId} className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-2">
          {sunnahList.map((def) => (
            <SunnahRow
              key={def.slot}
              date={date}
              prayerName={prayerName}
              def={def}
              completed={sunnahCompletions.includes(def.slot)}
            />
          ))}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
            className="mt-0.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
          >
            None
          </button>
        </div>
      )}
    </li>
  );
}
