import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import type { ContinueReading } from "@/lib/self-mastery/continue-reading";

/** Home entry back into the focus reader: last-read book, how far in, today's words vs the goal. One tap resumes. */
export function ContinueReadingCard({ reading }: { reading: ContinueReading | null }) {
  if (!reading) return null;
  const parts = [
    reading.progressPct !== null ? `${reading.progressPct}% read` : null,
    `${reading.todayWords.toLocaleString()}${reading.dailyWordGoal ? ` / ${reading.dailyWordGoal.toLocaleString()}` : ""} words today`,
    reading.streak > 0 ? `${reading.streak}-day streak` : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/read/${reading.bookId}`}
      data-testid="continue-reading-card"
      className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <IconChip icon={BookOpenText} accent="business" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">Continue reading: {reading.title}</div>
        <div className="text-xs text-muted-foreground">{parts.join(" · ")}</div>
      </div>
      <span className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium">Resume</span>
    </Link>
  );
}
