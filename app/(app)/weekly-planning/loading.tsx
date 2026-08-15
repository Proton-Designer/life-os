import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <section>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </section>
      <section className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </section>
    </PageContainer>
  );
}
