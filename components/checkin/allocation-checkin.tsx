"use client";

// Phase 2 of docs/superpowers/specs/2026-08-19-checkin-allocation-system.md.
//
// This is a QUANTITY bar, not a timeline. It shows how much of the 120-
// minute window went to each domain — never when, never in what order.
// It will look like Home's Day Ribbon (components/home/day-ribbon.tsx) at
// a glance and is deliberately NOT one: 15-minute chronological precision
// across a two-hour window is beyond what memory supports, so there is no
// time axis here, only proportion. Don't "fix" it into a timeline later.
//
// The component holds zero ALLOCATION arithmetic. increment/decrement/
// setMinutes/wastedMinutes (lib/checkins/allocation.ts, Phase 1) are the
// only source of truth for what's allowed — no defensive clamping here,
// their module is property-tested against 50,000 adversarial ops. The one
// exception is `minutesAtPointer` below, which is UI geometry (pixel → a
// candidate minute value), not allocation logic — it never decides what's
// allowed, it just answers "what minute is the pointer over," and the
// untrusted result is handed straight to setMinutes for the actual clamp.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOMAIN_KEYS,
  TOTAL_MINUTES,
  STARTER_BLOCK_MINUTES,
  emptyAllocation,
  wastedMinutes,
  increment,
  decrement,
  setMinutes,
  type Allocation,
  type DomainKey,
} from "@/lib/checkins/allocation";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { cn } from "@/lib/utils";

const DOMAIN_LABEL: Record<DomainKey, string> = {
  deen: "Deen",
  business: "Business",
  school: "School",
  fitness: "Fitness",
  co_op: "Work",
};

/**
 * "0m" at 0, "15m" under an hour, "1h 00m" (always zero-padded) at/over.
 * Was an em dash at 0 — sitting immediately left of the row's real "−"
 * decrement button, it read as a second, larger minus sign next to the
 * real one. "0m" removes the ambiguity.
 */
function formatMinutes(n: number): string {
  if (n === 0) return "0m";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatWindowLabel(windowStart: string, windowEnd: string, timezone: string, now: Date): string {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const range = `${fmt.format(start)} – ${fmt.format(end)}`;
  // A closed window must read as something that already happened — this
  // component's primary path is retroactive (see PROJECT_STATUS), not live.
  return end <= now ? `${range}, earlier` : range;
}

/**
 * Pure UI-geometry helper — NOT allocation logic (see file header). Maps a
 * pointer's clientX to the minute value it's hovering over, relative to
 * `domain`'s own segment start. The result is untrusted input; setMinutes
 * (Phase 1) owns the actual clamp/snap.
 */
export function minutesAtPointer(
  clientX: number,
  barRect: { left: number; width: number },
  allocation: Allocation,
  domain: DomainKey
): number {
  const x = Math.min(Math.max(clientX - barRect.left, 0), barRect.width);
  const domainIndex = DOMAIN_KEYS.indexOf(domain);
  let before = 0;
  for (let i = 0; i < domainIndex; i++) before += allocation[DOMAIN_KEYS[i]];
  const totalAtPointer = barRect.width === 0 ? 0 : (x / barRect.width) * TOTAL_MINUTES;
  return totalAtPointer - before;
}

export type AllocationCheckinProps = {
  /** ISO timestamp. */
  windowStart: string;
  /** ISO timestamp. */
  windowEnd: string;
  timezone: string;
  initialAllocation?: Allocation;
  /** Which domains the app pre-filled from real evidence (Lock-In / prayer window / workout) — partial only, never the whole window. */
  prefilled?: Partial<Record<DomainKey, boolean>>;
  /** Renders a lightweight "N of M" indicator when several check-ins are queued. Owns no queue state — that's Phase 3's. */
  queuePosition?: { index: number; total: number };
  /** Must be a bound Server Action reference if this component is ever handed one from a Server Component — see AGENTS.md. */
  onSave: (allocation: Allocation) => Promise<void>;
};

export function AllocationCheckin({
  windowStart,
  windowEnd,
  timezone,
  initialAllocation,
  prefilled = {},
  queuePosition,
  onSave,
}: AllocationCheckinProps) {
  const [allocation, setAllocation] = useState<Allocation>(initialAllocation ?? emptyAllocation());
  const [selected, setSelected] = useState<DomainKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [now] = useState(() => new Date());
  const barRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const draggingRef = useRef<DomainKey | null>(null);

  const wasted = wastedMinutes(allocation);
  const poolFull = wasted === 0;

  const selectDomain = useCallback((domain: DomainKey) => {
    setSelected((prev) => (prev === domain ? null : domain));
  }, []);

  // Clicking/tapping anywhere outside the bar and the domain rows clears
  // the selection — previously only re-tapping the exact same domain did.
  // The bar itself is exempted because a press there acts on the selected
  // domain (starts/adjusts its block, see handleBarPointerDown) rather
  // than dismissing it.
  useEffect(() => {
    if (!selected) return;
    function handlePointerDownOutside(e: PointerEvent) {
      const target = e.target as Node;
      if (barRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setSelected(null);
    }
    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside);
  }, [selected]);

  function handleIncrement(domain: DomainKey) {
    setAllocation((prev) => increment(prev, domain));
  }

  function handleDecrement(domain: DomainKey) {
    setAllocation((prev) => decrement(prev, domain));
  }

  function handleSliderKeyDown(domain: DomainKey, e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      handleIncrement(domain);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      handleDecrement(domain);
    } else if (e.key === "Home") {
      e.preventDefault();
      setAllocation((prev) => setMinutes(prev, domain, 0));
    } else if (e.key === "End") {
      e.preventDefault();
      setAllocation((prev) => setMinutes(prev, domain, prev[domain] + wastedMinutes(prev)));
    }
  }

  // Handlers live on the whole bar, not each domain's own segment — a
  // domain at 0 minutes renders its segment at 0% width (nothing to
  // receive a pointer event, no drag cursor could ever show), so the bar
  // itself is the only hit target that's reliably there regardless of the
  // selected domain's current value.
  function handleBarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!selected) return;
    const domain = selected;
    // A press on the bar for a domain still at 0 has nothing to drag from
    // — start it at a small block instead of requiring a drag gesture to
    // originate from a zero-width target.
    setAllocation((prev) => {
      if (prev[domain] > 0) return prev;
      const room = wastedMinutes(prev);
      if (room === 0) return prev;
      return { ...prev, [domain]: Math.min(STARTER_BLOCK_MINUTES, room) };
    });
    draggingRef.current = domain;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handleBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const domain = draggingRef.current;
    if (!domain || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const requested = minutesAtPointer(e.clientX, rect, allocation, domain);
    setAllocation((prev) => setMinutes(prev, domain, requested));
  }

  function handleBarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  async function handleDone() {
    setIsSaving(true);
    await onSave(allocation);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p data-testid="window-label" className="text-sm font-medium text-foreground">
          {formatWindowLabel(windowStart, windowEnd, timezone, now)}
        </p>
        {queuePosition && (
          <p className="text-xs text-muted-foreground">
            {queuePosition.index} of {queuePosition.total}
          </p>
        )}
      </div>

      <div
        ref={barRef}
        data-testid="allocation-bar"
        onPointerDown={handleBarPointerDown}
        onPointerMove={handleBarPointerMove}
        onPointerUp={handleBarPointerUp}
        onPointerCancel={handleBarPointerUp}
        className={cn(
          "flex h-6 w-full overflow-hidden rounded-full bg-muted",
          selected && "cursor-ew-resize touch-none"
        )}
        role="presentation"
      >
        {DOMAIN_KEYS.map((domain) => {
          const minutes = allocation[domain];
          const isSelected = selected === domain;
          return (
            <div
              key={domain}
              className={cn(
                "h-full transition-[width] duration-150 ease-out motion-reduce:transition-none",
                selected && !isSelected && "opacity-40"
              )}
              style={{
                width: `${(minutes / TOTAL_MINUTES) * 100}%`,
                backgroundColor: minutes > 0 ? `var(${ACCENT_VAR[DOMAIN_ACCENT[domain]]})` : undefined,
              }}
            />
          );
        })}
        <div
          className={cn(
            "h-full bg-muted-foreground/25 transition-[width] duration-150 ease-out motion-reduce:transition-none",
            selected && "opacity-40"
          )}
          style={{ width: `${(wasted / TOTAL_MINUTES) * 100}%` }}
        />
      </div>

      <ul ref={listRef} className="flex flex-col gap-2">
        {DOMAIN_KEYS.map((domain) => {
          const Icon = DOMAIN_ICON[domain];
          const minutes = allocation[domain];
          const isSelected = selected === domain;
          const ceiling = minutes + wasted;
          const wasPrefilled = prefilled[domain];

          return (
            <li
              key={domain}
              data-testid={`row-${domain}`}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2 transition-opacity",
                selected && !isSelected && "opacity-50"
              )}
            >
              <button
                type="button"
                onClick={() => selectDomain(domain)}
                aria-label={`Select ${DOMAIN_LABEL[domain]}`}
                aria-pressed={isSelected}
                className="flex min-h-11 flex-1 items-center gap-2 text-left"
              >
                <Icon
                  className="size-4 shrink-0"
                  style={{ color: `var(${ACCENT_VAR[DOMAIN_ACCENT[domain]]})` }}
                />
                <span className="text-sm font-medium">{DOMAIN_LABEL[domain]}</span>
                {wasPrefilled && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    App filled this in
                  </span>
                )}
              </button>

              {isSelected ? (
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${DOMAIN_LABEL[domain]} minutes`}
                  aria-valuenow={minutes}
                  aria-valuemin={0}
                  aria-valuemax={ceiling}
                  aria-valuetext={formatMinutes(minutes)}
                  onKeyDown={(e) => handleSliderKeyDown(domain, e)}
                  className="min-w-16 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1"
                >
                  {formatMinutes(minutes)}
                </div>
              ) : (
                <span className="min-w-16 text-right text-sm tabular-nums text-muted-foreground">
                  {formatMinutes(minutes)}
                </span>
              )}

              <button
                type="button"
                onClick={() => handleDecrement(domain)}
                disabled={minutes === 0}
                aria-label={`Decrease ${DOMAIN_LABEL[domain]}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/40 text-sm disabled:opacity-40"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => handleIncrement(domain)}
                disabled={poolFull}
                aria-label={`Increase ${DOMAIN_LABEL[domain]}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/40 text-sm disabled:opacity-40"
              >
                +
              </button>
            </li>
          );
        })}

        <li data-testid="row-wasted" className="flex items-center gap-3 px-3 py-2">
          <span className="flex min-h-11 flex-1 items-center gap-2">
            <span className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/50" />
            <span className="text-sm font-medium text-muted-foreground">Wasted</span>
          </span>
          <span className="min-w-16 text-right text-sm tabular-nums text-muted-foreground">
            {formatMinutes(wasted)}
          </span>
        </li>
      </ul>

      <p className="text-xs text-muted-foreground">Unassigned time counts as wasted.</p>

      <button
        type="button"
        onClick={handleDone}
        disabled={isSaving}
        className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Done
      </button>
    </div>
  );
}
