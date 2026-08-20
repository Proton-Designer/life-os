import { computeSessionCheckinSlots } from "./compute-session-checkin-slots";

/**
 * Per-hour Lock-In status derivation — pure, no React, no I/O.
 * docs/superpowers/specs/2026-08-19-missed-lockin-hours.md.
 *
 * Single source of truth for "what is hour X's status right now," used by
 * both live (client, ticking) and historical (server, fixed at endedAt)
 * readers, so the missed-hour derivation only ever lives in one place — the
 * README-level goal this whole spec is built around ("a stored row always
 * wins; silence plus a superseded slot derives as wasted," same
 * architecture as lib/deen/prayer-status.ts). No cron, no background
 * writer: a "missed" hour here is a read-time default, never persisted
 * until the user actually edits it (session-hour-actions.ts's
 * setSessionHourStatus), at which point it becomes a normal stored row —
 * this function has no way to tell "always was wasted" from "was missed,
 * then explicitly confirmed wasted," and doesn't need to; both render and
 * behave identically once state is `confirmed_wasted`.
 */

export type SessionHourState = "confirmed_business" | "confirmed_wasted" | "missed_wasted" | "pending";

export type ResolvedSessionHour = { hourStartIso: string; state: SessionHourState };

/**
 * `endedAt: null` means still active/live — the current due slot (if any)
 * stays `pending`, answerable, exactly as before this spec. `endedAt` set
 * means the session is closed: nothing can ever answer a fired-but-open
 * slot again, so the final due slot (if one exists at the moment the
 * session ended) resolves to `missed_wasted` too rather than staying
 * `pending` forever — a closed session has no future slot left to
 * supersede it, and permanent-pending would be a dead end in every surface
 * that reads this (the post-session card most of all, since that's the
 * whole point of making these hours reachable after the fact).
 */
export function resolveSessionHours(
  session: { startedAt: Date; endedAt: Date | null },
  intervalMinutes: number,
  now: Date,
  storedHours: { hourStartIso: string; domain: "business" | "wasted" }[]
): ResolvedSessionHour[] {
  const stored = new Map(storedHours.map((h) => [new Date(h.hourStartIso).getTime(), h.domain]));
  const effectiveNow = session.endedAt ?? now;

  const { dueSlot, missedSlots } = computeSessionCheckinSlots(
    session.startedAt,
    intervalMinutes,
    effectiveNow,
    storedHours.map((h) => new Date(h.hourStartIso))
  );

  const resolved: ResolvedSessionHour[] = [];
  for (const [t, domain] of stored) {
    resolved.push({
      hourStartIso: new Date(t).toISOString(),
      state: domain === "business" ? "confirmed_business" : "confirmed_wasted",
    });
  }
  for (const missed of missedSlots) {
    resolved.push({ hourStartIso: missed.toISOString(), state: "missed_wasted" });
  }
  if (dueSlot && session.endedAt !== null) {
    // Session closed with its last slot never answered — resolves to
    // missed, not left dangling as pending (see the function doc above).
    resolved.push({ hourStartIso: dueSlot.toISOString(), state: "missed_wasted" });
  }

  resolved.sort((a, b) => new Date(a.hourStartIso).getTime() - new Date(b.hourStartIso).getTime());
  return resolved;
}

/** The current answerable slot, or null if none is due (nothing fired yet, or the session has ended). Live sessions only — always null for a closed session, since resolveSessionHours folds a closed session's dangling due slot into `missed_wasted` instead. */
export function pendingSessionHour(
  session: { startedAt: Date; endedAt: Date | null },
  intervalMinutes: number,
  now: Date,
  storedHours: { hourStartIso: string; domain: "business" | "wasted" }[]
): string | null {
  if (session.endedAt !== null) return null;
  const { dueSlot } = computeSessionCheckinSlots(
    session.startedAt,
    intervalMinutes,
    now,
    storedHours.map((h) => new Date(h.hourStartIso))
  );
  return dueSlot ? dueSlot.toISOString() : null;
}

/** Every resolved hour's TimeRange (60-minute spans), for the double-count guard — schedule.ts's isWindowCoveredBySessionHours and prefill.ts's subtractResolvedHours both consume this shape directly. */
export function resolvedHourRanges(
  resolved: ResolvedSessionHour[],
  intervalMinutes: number
): { start: Date; end: Date }[] {
  return resolved.map((h) => {
    const start = new Date(h.hourStartIso);
    return { start, end: new Date(start.getTime() + intervalMinutes * 60_000) };
  });
}

/**
 * Extra `wasted` minutes a range-scoped historical reader (sn-ratio.ts,
 * focus-map.ts) needs to add on top of its normal stored-row sum, so a
 * missed hour reads as wasted there too — acceptance criterion 1 of
 * docs/superpowers/specs/2026-08-19-missed-lockin-hours.md ("every surface
 * that reads it — session ratio, Signal:Noise, Focus Map").
 *
 * Bounded to the caller's own query range: only sessions overlapping
 * [rangeStart, rangeEnd) are considered, and only a missed hour whose OWN
 * start falls inside that range counts — not "every session ever." A
 * session from outside the window contributes nothing here, the same way
 * its stored rows already wouldn't. This is a deliberate choice, not an
 * oversight (flagged by the Lead 2026-08-19): older unreachable history
 * simply reads as wasted-if-ever-queried, same as everything else the
 * range already includes — no separate floor, because the range parameter
 * itself is already the bound every other number in these two files
 * respects.
 *
 * Double-count guard: a missed hour already covered by a wider STORED row
 * (e.g. the surrounding 2h allocation window was later confirmed, and its
 * prefill correctly excluded this hour via subtractResolvedHours before
 * being saved — see prefill.ts) must NOT also get counted here, or the
 * same 60 minutes would be wasted-counted twice. `storedRowSpans` is every
 * stored checkin's own [window_start, window_end) in the same range,
 * regardless of source (hour-level or window-level) — a missed hour
 * contained inside any one of those spans is already accounted for and is
 * skipped.
 */
export function deriveExtraMissedWasteMinutes(
  sessions: { startedAt: Date; endedAt: Date | null; storedHours: { hourStartIso: string; domain: "business" | "wasted" }[] }[],
  storedRowSpans: { start: Date; end: Date }[],
  rangeStart: Date,
  rangeEnd: Date,
  now: Date,
  intervalMinutes = 60
): number {
  let extraWastedMinutes = 0;
  for (const session of sessions) {
    const resolved = resolveSessionHours(session, intervalMinutes, now, session.storedHours);
    for (const hour of resolved) {
      if (hour.state !== "missed_wasted") continue;
      const hourStart = new Date(hour.hourStartIso);
      if (hourStart.getTime() < rangeStart.getTime() || hourStart.getTime() >= rangeEnd.getTime()) continue;
      const hourEnd = new Date(hourStart.getTime() + intervalMinutes * 60_000);
      const alreadyCovered = storedRowSpans.some(
        (r) => r.start.getTime() <= hourStart.getTime() && r.end.getTime() >= hourEnd.getTime()
      );
      if (!alreadyCovered) extraWastedMinutes += intervalMinutes;
    }
  }
  return extraWastedMinutes;
}
