import Link from "next/link";
import { Button } from "@/components/ui/button";

/** The "we couldn't find that page" card shared by app/(app)/not-found.tsx and app/not-found.tsx. */
export function NotFoundCard() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
      <div data-testid="not-found" className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">We couldn&apos;t find that page</p>
          <p className="text-sm text-muted-foreground">It may have moved, or the link is out of date.</p>
        </div>
        <div>
          <Button asChild size="sm">
            <Link href="/">Go to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
