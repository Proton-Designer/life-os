import { FormSkeleton, PanelSkeleton } from "@/components/shell/route-skeleton";

// The capture route has no app shell by design; its skeleton is just the form card.
export default function CaptureLoading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8">
      <PanelSkeleton titleWidth="w-24">
        <FormSkeleton fields={2} />
      </PanelSkeleton>
    </main>
  );
}
