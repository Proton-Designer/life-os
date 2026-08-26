"use client";

import { useEffect, useOptimistic, useRef, useTransition } from "react";
import { toggleSunnah } from "@/app/(app)/deen/actions";
import { sunnahForPrayer, type SunnahDefinition, type SunnahSlot } from "@/lib/deen/sunnah";
import type { PrayerName } from "@/lib/prayer-times/windows";
import { cn } from "@/lib/utils";

/**
 * The sunnah disclosure body — shared between Deen's PrayerRow and Home's
 * Now-module prayer row (2026-08-25/26, Opus Lead ruling: "extract... do
 * NOT implement the timer twice"). Owns the sunnah option list, the "None"
 * button, and the 1.5s auto-collapse timer. Does NOT own the open/closed
 * boolean itself — Deen's and Home's headers are structurally different
 * (a whole-bar toggle vs a separate chevron button) and each already needs
 * that boolean for its own aria-expanded/chevron-rotation display, so this
 * component is controlled: it never renders unless its caller has already
 * decided to show it, and it only ever calls `onCollapse` to ask the caller
 * to hide it — for "None" (immediately) or after a real sunnah tap (1.5s
 * later).
 *
 * SAFE-TO-NEST CONTRACT: every button in here calls stopPropagation before
 * doing anything else. A caller (e.g. TaskRowList's `renderExpanded` slot)
 * may render this anywhere without worrying that a sunnah tap will also
 * fire an ancestor's own click handler — on Home, that ancestor completes
 * the FARD prayer, and a sunnah tap silently also marking the fard done
 * would be a real, silent data-writing bug. Don't rely on structural
 * placement (sibling vs descendant) alone to prevent that — this component
 * guarantees it itself.
 */

const AUTO_COLLAPSE_MS = 1500;

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

function SunnahOptionRow({
  date,
  prayerName,
  def,
  completed,
  onTap,
}: {
  date: string;
  prayerName: PrayerName;
  def: SunnahDefinition;
  completed: boolean;
  /**
   * Fires synchronously on the tap itself (not after the write settles),
   * with a promise that resolves once toggleSunnah actually lands — the
   * auto-collapse timer is armed from the TAP (Ayman: "after exactly 1.5
   * seconds"), and only consults this promise at fire time, to make sure
   * it never collapses over a write still in flight.
   */
  onTap: (writeSettled: Promise<void>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticCompleted, setOptimisticCompleted] = useOptimistic(
    completed,
    (_state, next: boolean) => next
  );

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const writeSettled = new Promise<void>((resolve) => {
      startTransition(async () => {
        setOptimisticCompleted(!optimisticCompleted);
        try {
          await toggleSunnah(date, prayerName, def.slot);
        } finally {
          resolve();
        }
      });
    });
    onTap(writeSettled);
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

export function SunnahDisclosure({
  date,
  prayerName,
  sunnahCompletions,
  panelId,
  onCollapse,
}: {
  date: string;
  prayerName: PrayerName;
  sunnahCompletions: SunnahSlot[];
  /** For the caller's own trigger button's aria-controls. */
  panelId?: string;
  /** Ask the caller to close this — immediately for "None", ~1.5s after a real sunnah tap for everything else. */
  onCollapse: () => void;
}) {
  const sunnahList = sunnahForPrayer(prayerName);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Invalidates a timer whose 1500ms already elapsed but was still waiting
  // on a slow write when a NEWER tap re-armed — without this, the stale
  // timer's `.finally` could still fire onCollapse after the newer timer
  // already has (or is about to).
  const tokenRef = useRef(0);

  function clearTimer() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  // Unmount (e.g. the row completes and disappears, or the panel is torn
  // down some other way) must disown any parked callback, not just clear a
  // still-pending setTimeout handle — a timer that already fired at 1500ms
  // but is still waiting on `writeSettled` has a null timeoutRef by then,
  // so clearTimer() alone wouldn't stop it from calling onCollapse() once
  // the write lands, into a component that's gone. Bumping the token here
  // disowns it the same way a newer tap does — the token is the only thing
  // that authorises a collapse, no exceptions.
  useEffect(
    () => () => {
      clearTimer();
      tokenRef.current++;
    },
    []
  );

  function handleTap(writeSettled: Promise<void>) {
    // Re-arm on every tap, not just the first — two taps in a row give
    // 1.5s from the LAST one, not a stale timer from the first firing
    // mid-interaction.
    clearTimer();
    const myToken = ++tokenRef.current;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      // The common case: the write already landed well before 1500ms, so
      // this resolves immediately and collapse happens at exactly 1500ms
      // from the tap. The defensive case: a write still in flight at
      // 1500ms defers collapse until it actually lands, rather than
      // hiding an unsettled (possibly failing) write.
      writeSettled.finally(() => {
        if (tokenRef.current === myToken) onCollapse();
      });
    }, AUTO_COLLAPSE_MS);
  }

  function handleNone() {
    clearTimer();
    tokenRef.current++;
    onCollapse();
  }

  return (
    <div id={panelId} className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-2">
      {sunnahList.map((def) => (
        <SunnahOptionRow
          key={def.slot}
          date={date}
          prayerName={prayerName}
          def={def}
          completed={sunnahCompletions.includes(def.slot)}
          onTap={handleTap}
        />
      ))}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleNone();
        }}
        className="mt-0.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/40"
      >
        None
      </button>
    </div>
  );
}
