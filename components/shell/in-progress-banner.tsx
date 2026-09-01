import Link from "next/link";

export interface InProgressItem {
  id: string;
  title: string;
  statusLabel: string;
  progressPct: number;
  href: string;
}

// D-004: a book upload takes real time, and before this existed there was
// no surface anywhere saying long-running work was even happening once a
// user navigated away from its own detail page. Generic by shape — takes
// plain {id, title, statusLabel, progressPct, href} items, not anything
// Self-Mastery-specific — so School's syllabus parsing can produce the
// same shape from its own data source later without a second component.
export function InProgressBanner({ items }: { items: InProgressItem[] }) {
  if (items.length === 0) return null;

  return (
    <div data-testid="in-progress-banner" className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="flex flex-col gap-1.5 rounded-lg transition-opacity hover:opacity-80"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-foreground">{item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{item.statusLabel}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-[var(--accent-info)] transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.min(100, item.progressPct))}%` }}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}
