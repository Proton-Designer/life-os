import { notFound } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { BookCoverChip } from "./book-cover-chip";
import { MemoryStrengthBar } from "./memory-strength-bar";
import { LessonCard } from "./lesson-card";
import { getBookDetail } from "@/lib/self-mastery/get-book-detail";
import { INGESTION_STAGE_LABEL, bucketIngestStage, looksUnclaimed } from "@/lib/self-mastery/ingestion-stage";

// No "Start studying" button anywhere on this page — per D-003, the
// session is entered from Home and interleaves across books and courses.
// This page owns the library and the per-book detail (lessons, mechanism/
// action_template, provenance, memory strength), never the session itself.
export async function BookDetailView({ bookId }: { bookId: string }) {
  const book = await getBookDetail(bookId);
  if (!book) notFound();

  const now = new Date();

  return (
    <PageContainer>
      <div className="flex items-center gap-4">
        <BookCoverChip title={book.title} author={book.author} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{book.title}</h1>
          {book.author ? <p className="text-sm text-muted-foreground">{book.author}</p> : null}
        </div>
      </div>

      {book.status === "failed" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">Couldn&apos;t process this book</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {book.errorMessage ?? "Something went wrong. Please try uploading again."}
          </p>
        </div>
      ) : book.status !== "ready" ? (
        <div className="rounded-2xl border border-border/40 bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            {looksUnclaimed(book.stage, new Date(book.createdAt), now)
              ? "Processing hasn't started yet"
              : INGESTION_STAGE_LABEL[bucketIngestStage(book.stage)]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {looksUnclaimed(book.stage, new Date(book.createdAt), now)
              ? "This usually means the processing service isn't running right now. No need to re-upload — it'll pick up automatically once it's back."
              : "This can take a while — a full book is a lot to read. Feel free to leave and come back; progress is saved on our end, not in this browser tab."}
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-[var(--accent-info)] transition-[width] duration-300"
              style={{ width: `${Math.max(2, book.progressPct)}%` }}
            />
          </div>
        </div>
      ) : null}

      {book.status === "ready" && book.lessons.length > 0 ? (
        <>
          <MemoryStrengthBar
            value={book.memoryStrength}
            label="Overall memory strength"
            reviewedCount={book.lessons.reduce((n, l) => n + l.cards.filter((c) => c.state !== "new").length, 0)}
            totalCount={book.lessons.reduce((n, l) => n + l.cards.length, 0)}
          />
          <div className="flex flex-col gap-4">
            {book.lessons.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </>
      ) : null}

      {book.status === "ready" && book.lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lessons found for this book yet.</p>
      ) : null}
    </PageContainer>
  );
}
