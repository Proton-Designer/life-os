"use client";

import { useTransition } from "react";
import { markPrayer } from "@/app/(app)/deen/actions";
import { cn } from "@/lib/utils";

export type PrayerName = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
export type PrayerStatus = "pending" | "on_time" | "qada" | "missed";

const STATUS_LABEL: Record<Exclude<PrayerStatus, "pending">, string> = {
  on_time: "On-time",
  qada: "Qada",
  missed: "Missed",
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

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        {(["on_time", "qada", "missed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => markPrayer(date, prayerName, s))}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              status === s
                ? "bg-accent-deen text-background"
                : "bg-accent/40 text-muted-foreground hover:bg-accent/70"
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </li>
  );
}
