import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { CloseLine } from "@/lib/quran/surfaces";

/** QURAN-02: the evening close's Quran line (reflect stage): "Quran today ✓ N pages", or a quiet "not yet" with a link to log it. Nothing without an active plan. */
export function QuranCloseLine({ line }: { line: CloseLine | null }) {
  if (!line) return null;
  return (
    <p className="flex items-center gap-2 rounded-lg border p-3 text-sm" data-testid="quran-close-line" data-kind={line.kind}>
      <BookOpen className="size-4 shrink-0 text-accent-deen" aria-hidden />
      <span className={line.kind === "done" ? "font-medium" : "text-muted-foreground"}>{line.text}</span>
      {line.kind === "not_yet" ? (
        <Link href="/deen" className="ml-auto text-xs underline underline-offset-2" data-testid="quran-close-log">
          Log it
        </Link>
      ) : null}
    </p>
  );
}
