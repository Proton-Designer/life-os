import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[168px] w-full rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Skeleton className="h-64 w-full rounded-2xl lg:col-span-7" />
        <Skeleton className="h-64 w-full rounded-2xl lg:col-span-5" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Skeleton className="h-56 w-full rounded-2xl lg:col-span-8" />
        <Skeleton className="h-56 w-full rounded-2xl lg:col-span-4" />
      </div>
    </PageContainer>
  );
}
