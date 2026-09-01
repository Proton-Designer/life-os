import { notFound } from "next/navigation";
import DeenPage from "@/app/(app)/deen/page";
import FitnessPage from "@/app/(app)/fitness/page";
import { SelfMasteryLibrary } from "@/components/self-mastery/self-mastery-library";

// Composes the EXISTING Deen/Fitness routes rather than duplicating their
// content (M5: adapt, don't rewrite) — each is just an async Server
// Component function, directly renderable here. Their own actions.ts
// imports resolve relative to where THEY are written, not this file, so
// this composition changes nothing about how either page fetches or
// mutates data; it only changes which URL renders it.
export default async function PersonalSubdomainPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;

  switch (subdomain) {
    case "faith":
      return <DeenPage />;
    case "fitness":
      return <FitnessPage />;
    case "self_mastery":
      return <SelfMasteryLibrary />;
    default:
      notFound();
  }
}
