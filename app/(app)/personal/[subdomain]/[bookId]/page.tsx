import { notFound } from "next/navigation";
import { BookDetailView } from "@/components/self-mastery/book-detail-view";

// Only reachable meaningfully under self_mastery — Faith/Fitness have no
// book concept. Nested inside [subdomain] (not a sibling "self-mastery/"
// route) specifically so it inherits [subdomain]/layout.tsx's subdomain-
// tab-switcher chrome, the same as every other Personal Growth screen.
export default async function PersonalBookDetailPage({
  params,
}: {
  params: Promise<{ subdomain: string; bookId: string }>;
}) {
  const { subdomain, bookId } = await params;
  if (subdomain !== "self_mastery") notFound();

  return <BookDetailView bookId={bookId} />;
}
