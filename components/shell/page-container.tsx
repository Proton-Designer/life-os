import { cn } from "@/lib/utils";

// The single place page width/padding is owned. Every route's page.tsx
// (and matching loading.tsx skeleton) wraps its content in this instead of
// each defining its own mx-auto/max-w-*/px-* — see
// docs/audits/2026-08-15-frontend-structure-audit.md for why that mattered.
export function PageContainer({
  className,
  children,
  ...props
}: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-8 md:px-6 md:py-12 xl:px-8", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// Opt-in 12-column grid for pages that lay out multiple panels side by side.
// Pages that are a single column top to bottom (Settings' section nav aside,
// auth screens) use PageContainer alone.
export function PageGrid({
  className,
  children,
  ...props
}: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("grid grid-cols-12 gap-4 xl:gap-5", className)} {...props}>
      {children}
    </div>
  );
}
