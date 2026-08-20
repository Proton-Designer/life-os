"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { resolveSessionHours, pendingSessionHour } from "@/lib/checkins/session-hour-status";
import { setSessionHourStatus } from "@/app/(app)/checkin/session-hour-actions";
import { endWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { SessionHourConfirm } from "./session-hour-confirm";
import { SessionHourList } from "./session-hour-list";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { featuredCardStyle } from "@/lib/featured-card-style";

const POLL_MS = 60 * 1000;
const INTERVAL_MINUTES = 60;

/** A real, stored hourly answer or edit — one checkin_allocations row each. */
export type StoredSessionHour = { hourStartIso: string; domain: "business" | "wasted" };

// docs/superpowers/specs/2026-08-19-missed-lockin-hours.md: an hour once
// superseded resolves to `wasted` at READ time, never written by anything
// but the user (resolveSessionHours/pendingSessionHour, both pure — no
// local accumulation of "missed" state needed anymore, unlike before this
// spec, since the derivation itself now owns that and re-runs fresh every
// tick from `storedHours` + `now`).
export function LockInSession({
  sessionId,
  startedAtIso,
  initialStoredHours,
  onEnded,
}: {
  sessionId: string;
  startedAtIso: string;
  initialStoredHours: StoredSessionHour[];
  onEnded: () => void;
}) {
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  const session = useMemo(() => ({ startedAt, endedAt: null }), [startedAt]);
  const [now, setNow] = useState(startedAt);
  const [storedHours, setStoredHours] = useState<StoredSessionHour[]>(initialStoredHours);
  const [offerEndAfterNo, setOfferEndAfterNo] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isConfirming, startConfirming] = useTransition();

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const resolved = useMemo(
    () => resolveSessionHours(session, INTERVAL_MINUTES, now, storedHours),
    [session, now, storedHours]
  );
  const pendingIso = useMemo(
    () => pendingSessionHour(session, INTERVAL_MINUTES, now, storedHours),
    [session, now, storedHours]
  );
  const unconfirmedCount = resolved.filter((h) => h.state === "missed_wasted").length;

  // Missed hours count as noise the moment they're superseded — the whole
  // point of the 2026-08-19 reversal (ignoring every prompt used to be the
  // highest-scoring path). Derived from resolved STATE, not the raw stored
  // rows, so the ratio updates live as an hour becomes missed, same as
  // every other surface that reads resolveSessionHours.
  const sessionSignalMinutes = resolved.filter((h) => h.state === "confirmed_business").length * 60;
  const sessionNoiseMinutes = resolved.filter((h) => h.state !== "confirmed_business").length * 60;
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

  function editHour(hourStartIso: string, status: "business" | "wasted") {
    setStoredHours((prev) => [...prev.filter((h) => h.hourStartIso !== hourStartIso), { hourStartIso, domain: status }]);
    startConfirming(async () => {
      await setSessionHourStatus(sessionId, hourStartIso, status);
    });
  }

  function handleAnswer(stillOnIt: boolean) {
    if (!pendingIso) return;
    editHour(pendingIso, stillOnIt ? "business" : "wasted");
    // Offer, don't force (2026-08-19, per the Lead): he may genuinely be
    // pausing for two minutes, not abandoning the session.
    if (!stillOnIt) setOfferEndAfterNo(true);
  }

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
          {unconfirmedCount > 0 && (
            <div className="text-xs text-muted-foreground">{unconfirmedCount} unconfirmed</div>
          )}
        </div>
      </div>

      <SessionHourList hours={resolved} onEdit={editHour} disabled={isConfirming} />

      {pendingIso && <SessionHourConfirm onAnswer={handleAnswer} disabled={isConfirming} />}

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
