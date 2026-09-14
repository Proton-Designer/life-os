import { notFound } from "next/navigation";
import { BookDetailView } from "@/components/self-mastery/book-detail-view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical, mode-independent book detail route (S6, 2026-09-14). See
 * ../page.tsx's header for why a legacy-mode-reachable route exists
 * alongside /personal/self_mastery/[bookId], and get-in-progress-books.ts /
 * self-mastery-library.tsx for the two real, found-live links that were
 * dead for a legacy account before this file existed (Home's "resume this
 * book" banner, and the library grid's own book cards).
 *
 * Same UUID validation as /personal/self_mastery/[bookId] and for the same
 * reason (found there first): a non-uuid segment reaching the database
 * returns a real 500, which reads to a user as "the app is broken" rather
 * than "there's nothing here." 404 is the honest answer either way.
 */
export default async function SelfMasteryBookDetailPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  if (!UUID_RE.test(bookId)) notFound();

  return <BookDetailView bookId={bookId} />;
}
