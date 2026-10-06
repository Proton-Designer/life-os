"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * An iOS-alarm-style time picker: three scrolling wheels (hour, minute, AM/PM) that snap to a row, with the chosen
 * row held in a highlighted band. Reads and writes the storage format, "HH:MM" 24-hour; what the person sees is
 * always 12-hour. Touch / trackpad scrolls a wheel; tapping a row jumps to it; ArrowUp / ArrowDown step a focused
 * wheel (so it works from a keyboard and for assistive tech: each wheel is a listbox of options).
 */

const ROW = 36;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ROW;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
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

function Wheel<T extends number | string>({ items, selected, label, format, onPick, className }: { items: readonly T[]; selected: T; label: string; format: (item: T) => string; onPick: (item: T) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, items.indexOf(selected));

  // Keep the scroll position in step with the value (initial paint, a tap, an arrow key, a "Now" jump).
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW) > ROW / 2) el.scrollTop = index * ROW;
  }, [index]);

  useEffect(() => () => void (settle.current && clearTimeout(settle.current)), []);

  const onScroll = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const next = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (next !== index) onPick(items[next]!);
    }, 90);
  }, [items, index, onPick]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => {
        const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        onPick(items[(index + step + items.length) % items.length]!);
      }}
      className={cn("snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] focus-visible:outline-none [&::-webkit-scrollbar]:hidden", className)}
      style={{ height: ROW * VISIBLE, paddingBlock: PAD }}
    >
      {items.map((item, i) => (
        <div
          key={String(item)}
          role="option"
          aria-selected={i === index}
          onClick={() => onPick(item)}
          className={cn("flex snap-center items-center justify-center text-xl tabular-nums transition-[opacity,transform] select-none", i === index ? "font-semibold text-foreground" : "cursor-pointer text-muted-foreground opacity-60 hover:opacity-100")}
          style={{ height: ROW }}
        >
          {format(item)}
        </div>
      ))}
    </div>
  );
}

export function WheelTimePicker({ value, onChange, label = "Start time" }: { value: string; onChange: (next: string) => void; label?: string }) {
  const { hour12, minute, pm } = split(value);
  return (
    <div className="relative mx-auto w-full max-w-64 rounded-xl bg-muted/50" role="group" aria-label={label}>
      {/* the highlighted band the chosen row sits in */}
      <div aria-hidden className="pointer-events-none absolute inset-x-2 rounded-lg bg-foreground/10" style={{ top: PAD, height: ROW }} />
      <div className="relative flex items-stretch justify-center gap-1 px-2" style={{ maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)" }}>
        <Wheel items={HOURS} selected={hour12} label={`${label} hour`} format={(h) => String(h)} onPick={(h) => onChange(join(h, minute, pm))} className="w-16 text-right [&>div]:justify-end [&>div]:pr-3" />
        <div aria-hidden className="flex items-center text-xl font-semibold" style={{ height: ROW * VISIBLE }}>
          :
        </div>
        <Wheel items={MINUTES} selected={minute} label={`${label} minute`} format={(m) => String(m).padStart(2, "0")} onPick={(m) => onChange(join(hour12, m, pm))} className="w-16 [&>div]:justify-start [&>div]:pl-3" />
        <Wheel items={MERIDIEMS} selected={pm ? "PM" : "AM"} label={`${label} AM or PM`} format={(x) => x} onPick={(x) => onChange(join(hour12, minute, x === "PM"))} className="w-16" />
      </div>
    </div>
  );
}
