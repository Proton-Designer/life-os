import Link from "next/link";
import { IconChip } from "@/components/ui/icon-chip";
import { DOMAIN_ICON } from "@/lib/domain-icons";

export function SnRatioCard({ display }: { display: string }) {
  return (
    <Link
      href="/insights?domain=business"
      className="flex items-center gap-4 rounded-2xl border border-border/40 bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <IconChip icon={DOMAIN_ICON.business} accent="business" />
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">This week&apos;s Signal:Noise</p>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-accent-business">{display}</p>
      </div>
    </Link>
  );
}
