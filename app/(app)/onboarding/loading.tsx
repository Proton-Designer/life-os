import { FormSkeleton, PanelSkeleton } from "@/components/shell/route-skeleton";

// Mirrors the onboarding wizard's centred single column (app/(app)/onboarding/page.tsx).
export default function OnboardingLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <PanelSkeleton titleWidth="w-40">
        <FormSkeleton fields={3} />
      </PanelSkeleton>
    </main>
  );
}
