import { notFound } from "next/navigation";
import WorkoutsPage from "@/app/(app)/fitness/workouts/page";

// /fitness/workouts, rendered under the Personal tab bar (this segment inherits [subdomain]/layout.tsx), so
// "My Workouts" -> "Back" keeps Faith / Self-Mastery / Fitness in view. Same composition as ../page.tsx.
export default async function PersonalWorkoutsPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;
  if (subdomain !== "fitness") notFound();
  return <WorkoutsPage />;
}
