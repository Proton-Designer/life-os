import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={1} />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}
