"use client";

import { useTransition } from "react";
import { adjustQadaBacklog } from "@/app/(app)/deen/actions";
import { Button } from "@/components/ui/button";

export function QadaCounter({ owed }: { owed: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={isPending}
        onClick={() => startTransition(() => adjustQadaBacklog(-1))}
        aria-label="Decrease qada owed"
      >
        −
      </Button>
      <span className="min-w-32 text-center text-sm">
        <span className="font-semibold">{owed}</span> qada owed
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={isPending}
        onClick={() => startTransition(() => adjustQadaBacklog(1))}
        aria-label="Increase qada owed"
      >
        +
      </Button>
    </div>
  );
}
