import Link from "next/link";
import { cn } from "@/lib/utils";

// Tier 4 — lives inside a Panel. Callers wrap a set of these in their own
// list container with `divide-y divide-border/40` (no individual borders —
// that's what distinguishes rows from Tier 1-3 cards).
const ROW_CLASS = "flex min-h-[52px] w-full items-center gap-3 px-1 py-2 text-left text-sm transition-colors hover:bg-foreground/[0.03]";

export function ListRow({
  leading,
  label,
  trailing,
  meta,
  href,
  onClick,
  className,
}: {
  leading: React.ReactNode;
  label: React.ReactNode;
  trailing?: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      {leading}
      <span className="flex-1 truncate">{label}</span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      {trailing}
    </>
  );

  if (href) {
    return (
      <Link href={href} data-testid="list-row" className={cn(ROW_CLASS, className)}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" data-testid="list-row" onClick={onClick} className={cn(ROW_CLASS, className)}>
        {content}
      </button>
    );
  }

  return (
    <div data-testid="list-row" className={cn(ROW_CLASS, className)}>
      {content}
    </div>
  );
}
