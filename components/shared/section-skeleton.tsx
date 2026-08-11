import { Skeleton } from "@/components/ui/skeleton";

// Roughly matches this app's dominant page shape (mx-auto max-w-2xl,
// <section><h1>...</h1><ul of card-height rows>...) so loading.tsx swapping
// to real content doesn't cause a large layout shift.
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section>
      <Skeleton className="mb-4 h-5 w-32" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </section>
  );
}
