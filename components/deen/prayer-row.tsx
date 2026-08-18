"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { markPrayer, toggleSunnah } from "@/app/(app)/deen/actions";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { sunnahForPrayer, type SunnahDefinition, type SunnahSlot } from "@/lib/deen/sunnah";
import type { PrayerName } from "@/lib/prayer-times/windows";
import type { EffectivePrayerStatus } from "@/lib/deen/prayer-status";
import { cn } from "@/lib/utils";

type ActionableStatus = "on_time" | "qada" | "missed";

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
    status,
    (_state, next: ActionableStatus) => next
  );
  const [expanded, setExpanded] = useState(false);
  const sunnahPanelId = useId();

  function handleClick(s: ActionableStatus) {
    startTransition(async () => {
      setOptimisticStatus(s);
      await markPrayer(date, prayerName, s);
    });
  }

  const sunnahList = sunnahForPrayer(prayerName);
  const completedCount = sunnahList.filter((s) => sunnahCompletions.includes(s.slot)).length;

  return (
    <li className="flex flex-col rounded-lg border border-border/40">
      {/* flex-wrap, no forced-nowrap breakpoint: the label + Upcoming
          indicator + 3 fard buttons + sunnah disclosure don't reliably fit
          on one line — not just at 390px, but also at 1024px on this page,
          since Deen's grid puts this panel in a column narrower than the
          viewport. A real overflow bug at both, caught by the
          layout-overflow spec, not by eyeballing at one width. Wraps
          whenever the row's own available width actually requires it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {status === "upcoming" && <span className="text-xs text-muted-foreground">Upcoming</span>}
          {(["on_time", "qada", "missed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={isPending}
              onClick={() => handleClick(s)}
              className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <Badge variant={optimisticStatus === s ? STATUS_VARIANT[s] : "neutral"}>
                {STATUS_LABEL[s]}
              </Badge>
            </button>
          ))}
          {sunnahList.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={sunnahPanelId}
              aria-label={`Sunnah for ${label}`}
              onClick={() => setExpanded((e) => !e)}
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
      {expanded && sunnahList.length > 0 && (
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
        </div>
      )}
    </li>
  );
}
