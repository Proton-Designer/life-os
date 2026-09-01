import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { BookCoverChip } from "./book-cover-chip";
import { MemoryStrengthBar } from "./memory-strength-bar";
import { UploadBookDialog } from "./upload-book-dialog";
import { getSelfMasteryLibrary } from "@/lib/self-mastery/get-library";
import { INGESTION_STAGE_LABEL, bucketIngestStage, looksUnclaimed } from "@/lib/self-mastery/ingestion-stage";
import type { LibraryBook } from "@/lib/self-mastery/types";

const STATUS_LABEL: Record<LibraryBook["status"], string> = {
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Couldn't process",
};

function statusLine(book: LibraryBook, now: Date): string {
  if (book.status === "ready") return "Ready";
  if (book.status === "failed") return STATUS_LABEL.failed;
  if (looksUnclaimed(book.stage, new Date(book.createdAt), now)) return "Not yet started";
  const bucket = bucketIngestStage(book.stage);
  return book.status === "uploading" ? STATUS_LABEL.uploading : INGESTION_STAGE_LABEL[bucket];
}

export async function SelfMasteryLibrary() {
  const books = await getSelfMasteryLibrary();
  const now = new Date();

  return (
    <PageContainer>
      <PageHeader title="Self-Mastery" description="Reading, learning, spaced review." actions={books.length > 0 ? <UploadBookDialog /> : null} />

      {books.length === 0 ? (
        // Not the generic EmptyState primitive — its action contract is a
        // plain href/onClick, and this action needs to open the upload
        // dialog (with its own file-pick/title/author flow), not navigate
        // or fire a bare callback. Same visual shape (icon, message,
        // centered action), just with UploadBookDialog's real trigger.
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <BookOpen className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
          <p className="max-w-xs text-sm text-muted-foreground">
            Upload a PDF and Self-Mastery turns it into a set of grounded lesson cards you can actually retain.
          </p>
          <UploadBookDialog trigger={<Button size="sm" variant="outline">Add a book</Button>} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <Link
              key={book.id}
              href={`/personal/self_mastery/${book.id}`}
              className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4 transition-colors hover:border-border"
            >
              <div className="flex items-start gap-3">
                <BookCoverChip title={book.title} author={book.author} coverHue={book.coverHue} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{book.title}</span>
                  {book.author ? <span className="truncate text-xs text-muted-foreground">{book.author}</span> : null}
                </div>
              </div>

              {book.status === "ready" ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    {book.lessonCount} lesson{book.lessonCount === 1 ? "" : "s"}
                  </span>
                  <MemoryStrengthBar value={book.memoryStrength} size="sm" />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{statusLine(book, now)}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
