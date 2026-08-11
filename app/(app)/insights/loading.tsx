import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={4} />
    </div>
  );
}
