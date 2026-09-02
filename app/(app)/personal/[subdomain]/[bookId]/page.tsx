import { notFound } from "next/navigation";
import { BookDetailView } from "@/components/self-mastery/book-detail-view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // A segment that is not a uuid is not a book id, and treating it as one
  // reaches the database with a malformed value and returns a FIVE HUNDRED.
  // Found trying `/personal/self_mastery/review`: the page rendered "A server
  // error occurred", which tells a user their app is broken rather than that
  // they typed a URL with nothing behind it. Any future sibling route under
  // this segment would have hit the same wall.
  //
  // 404 is the honest answer: nothing is here. It also means a real sibling
  // route added later fails loudly at build time as a conflict, instead of
  // being silently swallowed by this dynamic segment.
  if (!UUID_RE.test(bookId)) notFound();

  return <BookDetailView bookId={bookId} />;
}
