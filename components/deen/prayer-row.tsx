"use client";

import { useOptimistic, useTransition } from "react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

export type PrayerName = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
export type PrayerStatus = "pending" | "on_time" | "qada" | "missed";

const STATUS_LABEL: Record<Exclude<PrayerStatus, "pending">, string> = {
  on_time: "On-time",
  qada: "Qada",
  missed: "Missed",
};

// Same semantic split as Home's peek-card prayer dots: on-time is a clean
// completion (positive), qada arrived late (warning), missed is negative.
const STATUS_VARIANT: Record<Exclude<PrayerStatus, "pending">, BadgeVariant> = {
  on_time: "positive",
  qada: "warning",
  missed: "negative",
};

export function PrayerRow({
  date,
  prayerName,
  label,
  status,
}: {
  date: string;
  prayerName: PrayerName;
  label: string;
  status: PrayerStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    status,
    (_state, next: PrayerStatus) => next
  );

  function handleClick(s: Exclude<PrayerStatus, "pending">) {
    startTransition(async () => {
      setOptimisticStatus(s);
      await markPrayer(date, prayerName, s);
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        {(["on_time", "qada", "missed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={isPending}
            onClick={() => handleClick(s)}
            className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            <Badge variant={optimisticStatus === s ? STATUS_VARIANT[s] : "neutral"}>
              {STATUS_LABEL[s]}
            </Badge>
          </button>
        ))}
      </div>
    </li>
  );
}
