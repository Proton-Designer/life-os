import { notFound } from "next/navigation";
import { ReaderApp } from "@/components/reader/reader-app";
import { ReaderLoader } from "@/components/reader/reader-loader";
import { SAMPLE_BOOK_ID, SAMPLE_DOC } from "@/lib/reader/__fixtures__/sample-doc";
import { getReaderBootstrapCore, type ReaderBootstrap } from "@/lib/reader/server/core";
import { requireUser } from "@/lib/supabase/auth";
import type { ReaderDoc } from "@/lib/reader/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReaderPageData = { kind: "sample"; doc: ReaderDoc; backHref: string } | { kind: "book"; bootstrap: ReaderBootstrap; backHref: string };

const BACK_HREF = "/self-mastery";

/**
 * The ONE place the reader's data comes from. "sample" is permanent (the onboarding "Try the reader" demo). Real books
 * load the bootstrap (metadata, signed document URL, saved position, settings); the client component opens or prepares
 * the document. Only serializable values cross to the client.
 */
async function loadReaderPageData(bookId: string): Promise<ReaderPageData | null> {
  if (bookId === SAMPLE_BOOK_ID) return { kind: "sample", doc: SAMPLE_DOC, backHref: BACK_HREF };
  const { supabase, userId } = await requireUser();
  const result = await getReaderBootstrapCore(supabase, userId, bookId);
  return result.ok ? { kind: "book", bootstrap: result.bootstrap, backHref: BACK_HREF } : null;
}

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  // Same guard as the book pages: a non-uuid reaching the database is a 500, not a 404.
  if (bookId !== SAMPLE_BOOK_ID && !UUID_RE.test(bookId)) notFound();

  const data = await loadReaderPageData(bookId);
  if (!data) notFound();

  if (data.kind === "sample") return <ReaderApp bookId={bookId} doc={data.doc} backHref={data.backHref} />;
  const { bootstrap } = data;
  return (
    <ReaderLoader
      bookId={bookId}
      backHref={data.backHref}
      title={bootstrap.book.title}
      status={bootstrap.book.readerStatus}
      docUrl={bootstrap.docUrl}
      docVersion={bootstrap.book.docVersion}
      position={bootstrap.position ? { wordIndex: bootstrap.position.wordIndex, clientUpdatedAt: bootstrap.position.clientUpdatedAt } : null}
      settings={bootstrap.settings}
    />
  );
}
