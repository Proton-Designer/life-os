import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="flex justify-between gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="size-14 shrink-0 rounded-full" />
        ))}
      </div>
      <SectionSkeleton rows={3} />
    </div>
  );
}
