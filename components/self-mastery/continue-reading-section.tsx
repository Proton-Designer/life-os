import { ContinueReadingCard } from "./continue-reading-card";
import { getContinueReading } from "@/lib/self-mastery/continue-reading";

/** Async server wrapper so the page can drop it in a Suspense boundary and never wait on it. */
export async function ContinueReadingSection() {
  return <ContinueReadingCard reading={await getContinueReading()} />;
}
