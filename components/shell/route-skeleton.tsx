import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Shared building blocks for every route's loading.tsx (batch 5, Ayman:
// "the exact skeleton of the modules/widgets"). Each mirrors the real
// component's own chrome (border/radius/padding) so the swap from skeleton
// to real content doesn't shift layout — only the CONTENT inside each box
// differs (a Skeleton bar instead of real text). Kept in components/shell/
// rather than components/shared/ per this batch's file ownership split.
//
// Every root element below carries `route-skeleton-fade-in` (app/globals.css)
// — a 130ms-delayed fade, not instant visibility. A route that resolves
// inside the delay never paints a skeleton at all; only a genuinely slow one
// does (Opus Lead, batch 5 follow-up: an instant flash-then-swap reads as a
// flicker, not the "smooth load" Ayman asked for, and is the exact flash the
// 2026-08-16 nav-latency fix removed loading.tsx sitewide to avoid — see the
// dated note in docs/superpowers/specs/2026-08-16-navigation-latency-fix.md).
// Centralized here, on the primitive's own root, so a new call site can't
// forget it the way a per-route opt-in could.
export const FADE_IN = "route-skeleton-fade-in";

export function PageHeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", FADE_IN)}>
      <Skeleton className="h-9 w-40" />
      {withActions && <Skeleton className="h-8 w-32 rounded-full" />}
    </div>
  );
}

// Mirrors Panel's own chrome (ui/panel.tsx): rounded-2xl border bg-card p-4,
// a title-row, an optional heroValue row, then the body. `bodyHeight` is a
// Tailwind height class approximating the real content's height — pass
// `children` instead for a shape a single block can't approximate (a list
// of rows, a small grid).
export function PanelSkeleton({
  titleWidth = "w-24",
  hasHero = false,
  hasControls = false,
  bodyHeight = "h-32",
  className,
  children,
}: {
  titleWidth?: string;
  hasHero?: boolean;
  hasControls?: boolean;
  bodyHeight?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-4", FADE_IN, className)}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className={cn("h-4", titleWidth)} />
          {hasControls && <Skeleton className="h-8 w-20 rounded-md" />}
        </div>
        {hasHero && (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        )}
      </div>
      {children ?? <Skeleton className={cn("w-full rounded-lg", bodyHeight)} />}
    </div>
  );
}

// Mirrors KpiCard (ui/kpi-card.tsx): rounded-2xl border, min-h-168/120,
// icon chip top-left, value block bottom-anchored.
export function KpiCardSkeleton({ size = "default", className }: { size?: "default" | "sm"; className?: string }) {
  const isSm = size === "sm";
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-border/40 p-4", isSm ? "min-h-[120px] p-3" : "min-h-[168px]", FADE_IN, className)}>
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col justify-end gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className={cn(isSm ? "h-6 w-10" : "h-9 w-14")} />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

// The horizontal snap-scroll strip most routes open with (Deen/School/
// Insights KPI rows, Home's domain stack) — same responsive contract
// (snap-x on mobile, a real grid at md+) so nothing reflows on swap.
export function KpiStripSkeleton({
  count,
  size = "default",
  cols = "md:grid-cols-2 lg:grid-cols-3",
}: {
  count: number;
  size?: "default" | "sm";
  cols?: string;
}) {
  return (
    <div className={cn("flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:overflow-visible", cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCardSkeleton size={size} />
        </div>
      ))}
    </div>
  );
}

// Mirrors DomainStatusStack (home/domain-status-stack.tsx): 5 cards, icon +
// two text lines on the left, a progress ring on the right.
export function DomainStatusStripSkeleton() {
  return (
    <div className={cn("flex flex-col gap-2", FADE_IN)}>
      <Skeleton className="h-4 w-28" />
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex w-[46vw] shrink-0 snap-start items-center justify-between gap-2 rounded-2xl border border-border/40 bg-card p-3 md:w-auto"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="size-10 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors WeeklyGoalsHeader (shared/weekly-goals-header.tsx): the glowing
// divided card, two goal slots.
export function WeeklyGoalsHeaderSkeleton() {
  return (
    <div className={cn("flex flex-col gap-3", FADE_IN)}>
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-col divide-y divide-border/40 rounded-2xl border border-border/40 bg-card p-4 sm:flex-row sm:divide-x sm:divide-y-0">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex min-w-0 flex-1 items-center gap-3 py-3 first:pt-0 last:pb-0 sm:py-0 sm:first:pl-0 sm:last:pr-0 sm:px-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors a plain list of rows inside a Panel (Salah's 5 prayers, Task
// list's items, etc.) — same gap-2 flex column, each row a rounded-lg bar.
export function RowListSkeleton({ rows, rowHeight = "h-12" }: { rows: number; rowHeight?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", FADE_IN)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-lg", rowHeight)} />
      ))}
    </div>
  );
}
