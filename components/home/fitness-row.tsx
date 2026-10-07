import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { RowShell } from "@/components/shared/row-shell";
import { DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import type { PriorityItem } from "@/lib/home/types";

// Fitness never completes with a bare tap here (fitness spec §2.1: a blind tap produces rubber-stamped data, and rep
// goals aren't binary anyway) -- it navigates to /fitness instead. A link row, neither "toggle" nor "log". See
// docs/superpowers/specs/2026-08-23-home-fitness-row.md.
export function FitnessRow({ item, meta, emphasis }: { item: PriorityItem; meta: string; emphasis?: "focus" | "dim" }) {
  return (
    <RowShell emphasis={emphasis}>
      <Link href="/fitness" className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50">
        <IconChip icon={DOMAIN_ICON[item.domain]} accent={DOMAIN_ACCENT[item.domain]} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </RowShell>
  );
}
