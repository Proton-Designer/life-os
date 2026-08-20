"use client";

import { cn } from "@/lib/utils";
import type { SessionHourState, ResolvedSessionHour } from "@/lib/checkins/session-hour-status";

export type { ResolvedSessionHour };
export type ResolvedHourState = SessionHourState;

/**
 * Renders every RESOLVED hour (never "pending" — the live due slot has its
 * own dedicated confirm UI, SessionHourConfirm) with a visible, always-on
 * edit affordance per docs/superpowers/specs/2026-08-19-missed-lockin-hours.md:
 * a missed hour reads "Not confirmed," neutral — not an accusation — and
 * both options stay reachable with one tap, not hidden behind a menu or a
 * hover. Reuses the exact wording the live confirm already uses ("Still on
 * it" / "Not really") so editing a past hour feels like the same one-tap
 * action, not a separate "edit a record" ceremony.
 */
export function SessionHourList({
  hours,
  onEdit,
  disabled,
}: {
  hours: ResolvedSessionHour[];
  onEdit: (hourStartIso: string, status: "business" | "wasted") => void;
  disabled?: boolean;
}) {
  const rows = hours.filter((h) => h.state !== "pending");
  if (rows.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {rows.map((hour) => (
        <SessionHourRow key={hour.hourStartIso} hour={hour} onEdit={onEdit} disabled={disabled} />
      ))}
    </ul>
  );
}

function SessionHourRow({
  hour,
  onEdit,
  disabled,
}: {
  hour: ResolvedSessionHour;
  onEdit: (hourStartIso: string, status: "business" | "wasted") => void;
  disabled?: boolean;
}) {
  const isBusinessPressed = hour.state === "confirmed_business";
  const isWastedPressed = hour.state === "confirmed_wasted";

  return (
    <li
      data-testid={`session-hour-row-${hour.hourStartIso}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-1.5"
    >
      <div className="flex flex-col">
        <span className="text-muted-foreground">
          {new Date(hour.hourStartIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        {hour.state === "missed_wasted" && <span className="text-xs text-muted-foreground">Not confirmed</span>}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          aria-label="Still on it"
          aria-pressed={isBusinessPressed}
          disabled={disabled}
          onClick={() => onEdit(hour.hourStartIso, "business")}
          className={cn(
            "min-h-11 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50",
            isBusinessPressed
              ? "border-accent-business bg-accent-business/15 text-accent-business"
              : "border-border/40 text-muted-foreground hover:text-foreground"
          )}
        >
          Still on it
        </button>
        <button
          type="button"
          aria-label="Not really"
          aria-pressed={isWastedPressed}
          disabled={disabled}
          onClick={() => onEdit(hour.hourStartIso, "wasted")}
          className={cn(
            "min-h-11 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50",
            isWastedPressed
              ? "border-muted-foreground/50 bg-muted text-foreground"
              : "border-border/40 text-muted-foreground hover:text-foreground"
          )}
        >
          Not really
        </button>
      </div>
    </li>
  );
}
