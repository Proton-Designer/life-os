import { SectionSkeleton } from "@/components/shared/section-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={5} />
    </div>
  );
}
