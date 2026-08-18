import Link from "next/link";
import { buildTimeOfDayDistribution, dominantBucket } from "@/lib/deen/reflection-time-of-day";

export function ReflectionTimeOfDay({ entries, timezone }: { entries: { createdAt: string }[]; timezone: string }) {
  const buckets = buildTimeOfDayDistribution(entries, timezone);

  if (!buckets) {
    return <p className="text-sm text-muted-foreground">Not enough entries yet to show a time-of-day pattern.</p>;
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const cluster = dominantBucket(buckets);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              <div
                className="w-full rounded-t-sm bg-muted-foreground/40"
                style={{ height: `${Math.max(4, (b.count / maxCount) * 100)}%` }}
              />
            </div>
            <span className="text-center text-[10px] text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>

      {/* Observation, never a verdict (spec §6) — states what the data
          shows and offers one existing lever, doesn't judge. */}
      {cluster && (
        <div className="rounded-lg border border-border/40 p-3 text-sm">
          <p>
            This clusters in the <span className="font-medium">{cluster.label}</span> window.
          </p>
          <Link href="#habit-builder" className="text-accent-deen hover:underline">
            Consider a habit anchored to this window →
          </Link>
        </div>
      )}
    </div>
  );
}
