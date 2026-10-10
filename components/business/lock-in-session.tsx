"use client";

import { useEffect, useMemo, useState } from "react";
import { formatElapsedDuration, elapsedMinutesSince } from "@/lib/business/format-elapsed";
import { HourCompleteBanner } from "./hour-complete-banner";
import { EndOfHourReflection } from "./end-of-hour-reflection";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { featuredCardStyle } from "@/lib/featured-card-style";
import type { HourWorkInterval } from "@/lib/reflection-cards/types";

const POLL_MS = 60 * 1000;

/**
 * The /business presentation of a running Deep Work session. There is nothing to confirm: no hourly "Still on it?", no
 * Yes / No, no hour that turns into Wasted when nobody taps. The session's minutes count to Business on their own
 * (lib/checkins/session-accounting.ts).
 */
export function LockInSession({
  startedAtIso,
  onEndSession,
  onExpand,
}: {
  startedAtIso: string;
  // The Lock-In overlay provider owns the actual endWorkSession call (batch
  // 3) — ending anywhere must clear the session everywhere, not just here.
  onEndSession: () => Promise<void>;
  // Returns to the full-screen overlay (batch 3), this is the overlay's "minimized" presentation on /business.
  onExpand: () => void;
}) {
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  const [now, setNow] = useState(startedAt);
  const [isEnding, setIsEnding] = useState(false);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const elapsed = formatElapsedDuration(now.getTime() - startedAt.getTime());
  const elapsedMinutes = elapsedMinutesSince(startedAtIso, now);
  // "deep_work" hardcoded, not a prop: this component only ever renders for a deep_work session (LockInPanel's own
  // branch; the IconChip/DOMAIN_ICON.business below bake in the same assumption). A session IS real work, so the last
  // full hour is one honest interval.
  const hourIntervals: HourWorkInterval[] =
    elapsedMinutes >= 60 ? [{ domain: "deep_work", minutes: 60, isDistraction: false }] : [];

  async function handleEndSession() {
    setIsEnding(true);
    try {
      await onEndSession();
    } catch {
      setIsEnding(false);
    }
  }

  return (
    <div
      data-testid="lock-in-session"
      className="flex flex-col gap-4 rounded-2xl border p-4"
      style={featuredCardStyle(ACCENT_VAR.business)}
    >
      <div className="flex items-center gap-3">
        <IconChip icon={DOMAIN_ICON.business} accent="business" />
        <div>
          <div className="text-sm text-muted-foreground">Locked in</div>
          <div data-testid="lock-in-elapsed" className="font-mono text-2xl font-semibold tabular-nums">
            {elapsed}
          </div>
        </div>
      </div>

      <HourCompleteBanner elapsedMinutes={elapsedMinutes} />
      <div className="flex justify-end">
        <EndOfHourReflection elapsedMinutes={elapsedMinutes} intervals={hourIntervals} />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onExpand}>
          Expand
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={handleEndSession} disabled={isEnding}>
          End session
        </Button>
      </div>
    </div>
  );
}
