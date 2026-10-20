import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens a book in the focus reader (/read/<id>). Reads "Continue 42%" once the book has a bookmark. */
export function ReadButton({ bookId, progressPct, started, size = "sm" }: { bookId: string; progressPct: number | null; started: boolean; size?: "sm" | "default" }) {
  return (
    <Button asChild size={size} variant="outline" className="gap-1.5" data-testid="read-book">
      <Link href={`/read/${bookId}`}>
        <BookOpenText className="size-4" />
        {started ? (progressPct ? `Continue · ${progressPct}%` : "Continue") : "Read"}
      </Link>
    </Button>
  );
}
