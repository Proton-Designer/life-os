"use client";

import { useTransition } from "react";
import { adjustQadaBacklog } from "@/app/(app)/deen/actions";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";

export function QadaCounter({ owed }: { owed: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border/40 bg-card p-4">
      <IconChip icon={DOMAIN_ICON.deen} accent="deen" />
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Qada owed</p>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{owed}</p>
      </div>
      <div className="flex items-center gap-2">
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
    </div>
  );
}
