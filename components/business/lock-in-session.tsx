"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { computeSessionCheckinSlots } from "@/lib/checkins/compute-session-checkin-slots";
import { confirmSessionHour } from "@/app/(app)/checkin/session-hour-actions";
import { endWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { SessionHourConfirm } from "./session-hour-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { featuredCardStyle } from "@/lib/featured-card-style";

const POLL_MS = 60 * 1000;
const INTERVAL_MINUTES = 60;

/** An hourly confirm that was actually answered (Yes or No) — one real checkin_allocations row each, from confirmSessionHour. */
export type SessionHourConfirmation = { hourStartIso: string; stillOnIt: boolean };

// Client-only, never persisted — a missed hour deliberately writes nothing
// (see session-hour-actions.ts's doc comment), so this is purely "what did
// I see this tab session," not a durable record. Ayman's own note: nearly
// free to surface, not worth a server round trip to make durable.
type LocalMissedHour = { hourStartIso: string };

export function LockInSession({
  sessionId,
  startedAtIso,
  initialConfirmedHours,
  sessionSignalMinutes,
  sessionNoiseMinutes,
  onEnded,
}: {
  sessionId: string;
  startedAtIso: string;
  initialConfirmedHours: SessionHourConfirmation[];
  // Real allocation minutes from confirmSessionHour's own writes — the
  // hourly confirm below is what actually populates these now (2026-08-19).
  sessionSignalMinutes: number;
  sessionNoiseMinutes: number;
  onEnded: () => void;
}) {
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  const [now, setNow] = useState(startedAt);
  const [confirmedHours, setConfirmedHours] = useState<SessionHourConfirmation[]>(initialConfirmedHours);
  const [missedHours, setMissedHours] = useState<LocalMissedHour[]>([]);
  const [dueSlot, setDueSlot] = useState<Date | null>(null);
  const [offerEndAfterNo, setOfferEndAfterNo] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isConfirming, startConfirming] = useTransition();

  const answeredRef = useRef(new Set(initialConfirmedHours.map((c) => new Date(c.hourStartIso).getTime())));
  const seenMissedRef = useRef(new Set<number>());
  const shownSlotRef = useRef<number | null>(null);

  const check = useCallback(() => {
    const nowDate = new Date();

    const result = computeSessionCheckinSlots(
      startedAt,
      INTERVAL_MINUTES,
      nowDate,
      [...answeredRef.current].map((t) => new Date(t))
    );

    for (const missed of result.missedSlots) {
      const t = missed.getTime();
      if (!seenMissedRef.current.has(t)) {
        seenMissedRef.current.add(t);
        setMissedHours((prev) => [...prev, { hourStartIso: missed.toISOString() }]);
      }
    }

    if (!result.dueSlot) {
      setDueSlot(null);
      return;
    }

    const dueTime = result.dueSlot.getTime();
    if (shownSlotRef.current === dueTime) return; // already showing this slot

    shownSlotRef.current = dueTime;
    setDueSlot(result.dueSlot);
  }, [startedAt]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_MS);
    return () => clearInterval(interval);
  }, [check]);

  const snDisplay = computeRatioDisplay(
    sessionSignalMinutes,
    sessionNoiseMinutes,
    sessionSignalMinutes + sessionNoiseMinutes > 0
  );
  const elapsed = formatElapsedDuration(now.getTime() - startedAt.getTime());

  async function handleEndSession() {
    setIsEnding(true);
    try {
      await endWorkSession(sessionId);
      onEnded();
    } catch {
      setIsEnding(false);
    }
  }

  function handleAnswer(stillOnIt: boolean) {
    if (!dueSlot) return;
    const hourStartIso = dueSlot.toISOString();
    answeredRef.current.add(dueSlot.getTime());
    setConfirmedHours((prev) => [...prev, { hourStartIso, stillOnIt }]);
    shownSlotRef.current = null;
    setDueSlot(null);
    // Offer, don't force (2026-08-19, per the Lead): he may genuinely be
    // pausing for two minutes, not abandoning the session.
    if (!stillOnIt) setOfferEndAfterNo(true);
    startConfirming(async () => {
      await confirmSessionHour(sessionId, hourStartIso, stillOnIt);
    });
  }

  const activityLog = [
    ...confirmedHours.map((c) => ({ time: c.hourStartIso, label: c.stillOnIt ? "Still on it" : "Not really", missed: false })),
    ...missedHours.map((m) => ({ time: m.hourStartIso, label: "Missed", missed: true })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return (
    <div
      data-testid="lock-in-session"
      className="flex flex-col gap-4 rounded-2xl border p-4"
      style={featuredCardStyle(ACCENT_VAR.business)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconChip icon={DOMAIN_ICON.business} accent="business" />
          <div>
            <div className="text-sm text-muted-foreground">Locked in</div>
            <div data-testid="lock-in-elapsed" className="font-mono text-2xl font-semibold tabular-nums">
              {elapsed}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">This session&apos;s Signal:Noise</div>
          <div
            data-testid="lock-in-session-ratio"
            className="font-mono text-lg font-semibold tabular-nums text-accent-business"
          >
            {snDisplay}
          </div>
          {missedHours.length > 0 && (
            <div className="text-xs text-muted-foreground">{missedHours.length} unconfirmed</div>
          )}
        </div>
      </div>

      {activityLog.length > 0 && (
        <ul data-testid="lock-in-checkin-list" className="flex flex-col gap-1.5 text-sm">
          {activityLog.map((entry) => (
            <li key={entry.time} className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <Badge variant={entry.missed ? "neutral" : entry.label === "Still on it" ? "positive" : "warning"}>
                {entry.label}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {dueSlot && <SessionHourConfirm onAnswer={handleAnswer} disabled={isConfirming} />}

      {offerEndAfterNo && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2 text-sm">
          <span>End the session?</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleEndSession} disabled={isEnding}>
              End session
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOfferEndAfterNo(false)}>
              Keep going
            </Button>
          </div>
        </div>
      )}

      <Button type="button" variant="outline" onClick={handleEndSession} disabled={isEnding}>
        End session
      </Button>
    </div>
  );
}
