import { notFound } from "next/navigation";
import { ReaderApp } from "@/components/reader/reader-app";
import { SAMPLE_BOOK_ID, SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import type { ReaderDoc } from "@/lib/reader/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReaderPageData {
  doc: ReaderDoc;
  backHref: string;
}

/**
 * The ONE place the reader's data comes from. "sample" is permanent (the onboarding "Try the reader" demo). Real books
 * return null until the reader bootstrap (R3: signed doc URL + saved position) is wired in here; swapping this
 * function's body is the only change the page needs.
 */
async function loadReaderPageData(bookId: string): Promise<ReaderPageData | null> {
  if (bookId === SAMPLE_BOOK_ID) return { doc: SAMPLE_DOC, backHref: "/self-mastery" };
  return null;
}

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  // Same guard as the book pages: a non-uuid reaching the database is a 500, not a 404.
  if (bookId !== SAMPLE_BOOK_ID && !UUID_RE.test(bookId)) notFound();

  const data = await loadReaderPageData(bookId);
  if (!data) notFound();

  return <ReaderApp bookId={bookId} doc={data.doc} backHref={data.backHref} />;
}
