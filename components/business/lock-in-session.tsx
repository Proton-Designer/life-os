"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeSessionCheckinSlots } from "@/lib/checkins/compute-session-checkin-slots";
import { recordMissedCheckin, getCheckinOptionsForNow } from "@/app/(app)/checkin/actions";
import { endWorkSession } from "@/app/(app)/business/actions";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { CheckinPrompt } from "@/components/checkin/checkin-prompt";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { ACCENT_VAR } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import type { CheckinOption } from "@/lib/checkins/types";

// Signal (kill_list) is positive, noise is a warning, an unanswered/missed
// slot is neutral — same semantic split established for Home's peek cards.
const CHECKIN_VARIANT: Record<string, BadgeVariant> = {
  kill_list: "positive",
  noise: "warning",
};

const POLL_MS = 60 * 1000;
const INTERVAL_MINUTES = 60;

export type SessionCheckin = {
  checkinTime: string;
  tagType: string | null;
  tagLabel: string | null;
  answered: boolean;
};

export function LockInSession({
  sessionId,
  startedAtIso,
  initialCheckins,
  onEnded,
}: {
  sessionId: string;
  startedAtIso: string;
  initialCheckins: SessionCheckin[];
  onEnded: () => void;
}) {
  const startedAt = useMemo(() => new Date(startedAtIso), [startedAtIso]);
  const [now, setNow] = useState(startedAt);
  const [checkins, setCheckins] = useState<SessionCheckin[]>(initialCheckins);
  const [dueSlot, setDueSlot] = useState<Date | null>(null);
  const [options, setOptions] = useState<CheckinOption[]>([]);
  const [isEnding, setIsEnding] = useState(false);

  const answeredRef = useRef(
    new Set(initialCheckins.filter((c) => c.answered).map((c) => new Date(c.checkinTime).getTime()))
  );
  const recordedMissedRef = useRef(
    new Set(initialCheckins.filter((c) => !c.answered).map((c) => new Date(c.checkinTime).getTime()))
  );
  const shownSlotRef = useRef<number | null>(null);

  const check = useCallback(async () => {
    const nowDate = new Date();

    const result = computeSessionCheckinSlots(
      startedAt,
      INTERVAL_MINUTES,
      nowDate,
      [...answeredRef.current].map((t) => new Date(t))
    );

    for (const missed of result.missedSlots) {
      const t = missed.getTime();
      if (!recordedMissedRef.current.has(t)) {
        recordedMissedRef.current.add(t);
        setCheckins((prev) => [
          ...prev,
          { checkinTime: missed.toISOString(), tagType: null, tagLabel: null, answered: false },
        ]);
        recordMissedCheckin(missed.toISOString(), sessionId).catch(() => {
          recordedMissedRef.current.delete(t); // retry on next poll if the write failed
        });
      }
    }

    if (!result.dueSlot) {
      setDueSlot(null);
      return;
    }

    const dueTime = result.dueSlot.getTime();
    if (shownSlotRef.current === dueTime) return; // already showing this slot

    shownSlotRef.current = dueTime;
    const opts = await getCheckinOptionsForNow(nowDate.toISOString());
    setOptions(opts);
    setDueSlot(result.dueSlot);
  }, [startedAt, sessionId]);

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

  const answered = checkins.filter((c) => c.answered);
  const signal = answered.filter((c) => c.tagType === "kill_list").length;
  const noise = answered.filter((c) => c.tagType === "noise").length;
  const snDisplay = computeRatioDisplay(signal, noise, answered.length > 0);
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

  return (
    <div
      data-testid="lock-in-session"
      className="flex flex-col gap-4 rounded-2xl border p-4"
      style={{
        borderColor: `color-mix(in oklch, var(${ACCENT_VAR.business}) 30%, transparent)`,
        background: `radial-gradient(ellipse at top left, color-mix(in oklch, var(${ACCENT_VAR.business}) 16%, transparent), transparent 70%)`,
      }}
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
        </div>
      </div>

      {checkins.length > 0 && (
        <ul data-testid="lock-in-checkin-list" className="flex flex-col gap-1.5 text-sm">
          {checkins.map((c) => (
            <li key={c.checkinTime} className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {new Date(c.checkinTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <Badge variant={c.answered ? (c.tagType ? CHECKIN_VARIANT[c.tagType] : "neutral") : "neutral"}>
                {c.answered ? (c.tagLabel ?? c.tagType) : "Missed"}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" onClick={handleEndSession} disabled={isEnding}>
        End session
      </Button>

      {dueSlot && (
        <CheckinPrompt
          open
          checkinTime={dueSlot.toISOString()}
          intervalMinutes={INTERVAL_MINUTES}
          options={options}
          workSessionId={sessionId}
          onAnswered={(option) => {
            // No option means "Skip check-ins today" was pressed instead of
            // an actual selection — nothing was recorded, so don't add a
            // fabricated entry to the session's answered list.
            if (option) {
              answeredRef.current.add(dueSlot.getTime());
              setCheckins((prev) => [
                ...prev,
                {
                  checkinTime: dueSlot.toISOString(),
                  tagType: option.tagType,
                  tagLabel: option.label,
                  answered: true,
                },
              ]);
            }
            shownSlotRef.current = null;
            setDueSlot(null);
          }}
          onSnoozed={() => {
            shownSlotRef.current = null;
            setDueSlot(null);
          }}
        />
      )}
    </div>
  );
}
