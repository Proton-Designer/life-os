import Link from "next/link";

export function SnRatioCard({ display }: { display: string }) {
  return (
    <Link
      href="/insights?domain=business"
      className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <span className="text-sm text-muted-foreground">This week&apos;s Signal:Noise</span>
      <span className="text-lg font-semibold text-accent-business">{display}</span>
    </Link>
  );
}
