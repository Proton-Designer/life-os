"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An iOS-alarm-style time picker: three scrolling wheels (hour, minute, AM/PM) that snap to a row, with the chosen
 * row held in a highlighted band. Reads and writes the storage format, "HH:MM" 24-hour; what the person sees is
 * always 12-hour. Touch / trackpad scrolls a wheel natively; a mouse can press and drag a wheel 1:1; tapping a row
 * jumps to it; ArrowUp / ArrowDown step a focused wheel (so it works from a keyboard and for assistive tech: each
 * wheel is a listbox of options).
 *
 * `minuteStep` (default 1) thins the minute wheel; a stored minute that is off the step is still listed, so an
 * existing 8:48 shows as 8:48 and is not silently rounded.
 */

const ROW = 30;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ROW;
/** A press that moves less than this many px is a click, not a drag. */
const DRAG_THRESHOLD = 4;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MERIDIEMS = ["AM", "PM"] as const;

function split(value: string): { hour12: number; minute: number; pm: boolean } {
  const m = /^(\d{2}):(\d{2})/.exec(value);
  const h24 = m ? Number(m[1]) : 9;
  const minute = m ? Number(m[2]) : 0;
  return { hour12: h24 % 12 === 0 ? 12 : h24 % 12, minute, pm: h24 >= 12 };
}

function join(hour12: number, minute: number, pm: boolean): string {
  const h24 = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minuteItems(step: number, current: number): number[] {
  const safeStep = step >= 1 ? Math.floor(step) : 1;
  const list = Array.from({ length: Math.ceil(60 / safeStep) }, (_, i) => i * safeStep);
  if (!list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

function Wheel<T extends number | string>({ items, selected, label, format, onPick, className }: { items: readonly T[]; selected: T; label: string; format: (item: T) => string; onPick: (item: T) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startY: number; startTop: number; pointerId: number; active: boolean } | null>(null);
  const justDragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const index = Math.max(0, items.indexOf(selected));

  // Keep the scroll position in step with the value (initial paint, a tap, an arrow key, a "Now" jump).
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW) > ROW / 2) el.scrollTop = index * ROW;
  }, [index]);

  useEffect(() => () => void (settle.current && clearTimeout(settle.current)), []);

  const nearest = useCallback(
    (el: HTMLElement) => Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW))),
    [items.length],
  );

  const onScroll = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el || drag.current?.active) return;
      const next = nearest(el);
      if (next !== index) onPick(items[next]!);
    }, 90);
  }, [items, index, onPick, nearest]);

  // Mouse only: touch and trackpad keep their native scrolling. Capture is taken only once the press has moved past the
  // threshold, so a plain click still lands on the row under the pointer.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { startY: e.clientY, startTop: e.currentTarget.scrollTop, pointerId: e.pointerId, active: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      d.active = true;
      el.setPointerCapture(d.pointerId);
      el.style.scrollSnapType = "none"; // snap-mandatory fights a programmatic scrollTop
      setDragging(true);
    }
    el.scrollTop = d.startTop - dy;
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    if (el.hasPointerCapture(d.pointerId)) el.releasePointerCapture(d.pointerId);
    el.style.scrollSnapType = "";
    setDragging(false);
    justDragged.current = true; // swallow the click the browser fires after a drag release
    setTimeout(() => (justDragged.current = false), 0);
    const next = nearest(el);
    el.scrollTo({ top: next * ROW, behavior: "smooth" });
    if (next !== index) onPick(items[next]!);
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        onPick(items[(index + step + items.length) % items.length]!);
      }}
      className={cn("snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] focus-visible:outline-none [&::-webkit-scrollbar]:hidden", dragging ? "cursor-grabbing" : "cursor-grab", className)}
      style={{ height: ROW * VISIBLE, paddingBlock: PAD }}
    >
      {items.map((item, i) => (
        <div
          key={String(item)}
          role="option"
          aria-selected={i === index}
          onClick={() => {
            if (justDragged.current) return;
            onPick(item);
          }}
          className={cn("flex snap-center items-center justify-center text-lg tabular-nums transition-[opacity,transform] select-none", i === index ? "font-semibold text-foreground" : "text-muted-foreground opacity-60 hover:opacity-100")}
          style={{ height: ROW }}
        >
          {format(item)}
        </div>
      ))}
    </div>
  );
}

export function WheelTimePicker({ value, onChange, label = "Start time", minuteStep = 1 }: { value: string; onChange: (next: string) => void; label?: string; minuteStep?: number }) {
  const { hour12, minute, pm } = split(value);
  const minutes = minuteItems(minuteStep, minute);
  return (
    <div className="relative mx-auto w-full max-w-56 rounded-xl bg-muted/50" role="group" aria-label={label}>
      {/* the highlighted band the chosen row sits in */}
      <div aria-hidden className="pointer-events-none absolute inset-x-2 rounded-lg bg-foreground/10" style={{ top: PAD, height: ROW }} />
      <div className="relative flex items-stretch justify-center gap-1 px-2" style={{ maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)" }}>
        <Wheel items={HOURS} selected={hour12} label={`${label} hour`} format={(h) => String(h)} onPick={(h) => onChange(join(h, minute, pm))} className="w-14 text-right [&>div]:justify-end [&>div]:pr-3" />
        <div aria-hidden className="flex items-center text-lg font-semibold" style={{ height: ROW * VISIBLE }}>
          :
        </div>
        <Wheel items={minutes} selected={minute} label={`${label} minute`} format={(m) => String(m).padStart(2, "0")} onPick={(m) => onChange(join(hour12, m, pm))} className="w-14 [&>div]:justify-start [&>div]:pl-3" />
        <Wheel items={MERIDIEMS} selected={pm ? "PM" : "AM"} label={`${label} AM or PM`} format={(x) => x} onPick={(x) => onChange(join(hour12, minute, x === "PM"))} className="w-14" />
      </div>
    </div>
  );
}
