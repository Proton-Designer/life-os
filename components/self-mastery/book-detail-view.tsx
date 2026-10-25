import { notFound } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { BookCoverChip } from "./book-cover-chip";
import { MemoryStrengthBar } from "./memory-strength-bar";
import { LessonCard } from "./lesson-card";
import { Button } from "@/components/ui/button";
import { OpenOriginalLink } from "./open-original-link";
import { ReadButton } from "./read-button";
import { RetryBookButton } from "./retry-book-button";
import { PromoteLessonSheet } from "@/components/promotions/promote-lesson-sheet";
import { getPromotableAreas, getActivePromotionForLesson } from "@/lib/promotions/read";
import { hasAction } from "@/lib/promotions/types";
import { getBookDetail } from "@/lib/self-mastery/get-book-detail";
import { looksUnclaimed, processingLabel } from "@/lib/self-mastery/ingestion-stage";
import { AutoRefreshWhileProcessing } from "./auto-refresh-while-processing";
import { AgentWorkCard } from "./agent-work-card";

// No "Start studying" button anywhere on this page — per D-003, the
// session is entered from Home and interleaves across books and courses.
// This page owns the library and the per-book detail (lessons, mechanism/
// action_template, provenance, memory strength), never the session itself.
export async function BookDetailView({ bookId }: { bookId: string }) {
  const book = await getBookDetail(bookId);
  if (!book) notFound();

  const now = new Date();

  // One query for the whole page, hoisted above the lesson loop as the
  // contract asks — not called per lesson.
  const promotableAreas = await getPromotableAreas();

  // Resolve every lesson's active promotion BEFORE the loop. The contract's
  // getActivePromotionForLesson is per-lesson, and calling it inside .map()
  // is both illegal (await in a non-async callback) and an N+1. Resolving in
  // parallel keeps it one round trip's latency instead of N.
  const activePromotions = new Map(
    await Promise.all(
      book.lessons.map(async (l) => [l.id, await getActivePromotionForLesson(l.id)] as const)
    )
  );

  return (
    <PageContainer>
      <div className="flex items-center gap-4">
        <BookCoverChip title={book.title} author={book.author} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{book.title}</h1>
          {book.author ? <p className="text-sm text-muted-foreground">{book.author}</p> : null}
          <OpenOriginalLink url={book.sourceUrl} />
        </div>
        {book.canRead ? (
          <div className="ml-auto">
            <ReadButton bookId={bookId} progressPct={book.readProgress?.pct ?? null} started={book.readProgress != null} size="default" />
          </div>
        ) : null}
      </div>

      {book.status === "failed" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">Couldn&apos;t process this book</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {book.errorMessage ?? "Something went wrong. Please try uploading again."}
          </p>
          <div className="mt-3">
            <RetryBookButton bookId={bookId} title={book.title} errorMessage={book.errorMessage} />
          </div>
        </div>
      ) : book.status !== "ready" && book.agentWork ? (
        <>
          {/* A connected agent is doing this book's model steps (no AI key): the real count, not a spinner. Still polls, so a finished step shows. */}
          <AutoRefreshWhileProcessing active />
          <AgentWorkCard bookId={bookId} progress={book.agentWork} />
        </>
      ) : book.status !== "ready" ? (
        (() => {
          // S6, 2026-09-14: a third real state, distinct from "never
          // claimed" and "genuinely still working" — see looksStalled's own
          // header (lib/self-mastery/ingestion-stage.ts) and this page's
          // book prop (get-book-detail.ts), which is the only place that
          // reads ingestion_jobs.updated_at to compute it. Ordered
          // unclaimed-first: the two are mutually exclusive by
          // looksStalled's own definition (it returns false for `queued`),
          // but unclaimed is the more specific, more useful thing to say
          // when both could in principle apply.
          const unclaimed = looksUnclaimed(book.stage, new Date(book.createdAt), now);
          const stalled = !unclaimed && book.looksStalled;
          const title = unclaimed
            ? "Processing hasn't started yet"
            : stalled
              ? "This seems to have stalled"
              : processingLabel(book.stage, book.progressPct);
          const body = unclaimed
            ? "This usually means the processing service isn't running right now. No need to re-upload — it'll pick up automatically once it's back."
            : stalled
              ? "This hasn't moved in a few minutes, longer than a normal step takes. No need to re-upload — it usually catches back up on its own. If it's still stuck next time you check, try uploading it again."
              : "This can take a while — a full book is a lot to read. Feel free to leave and come back; progress is saved on our end, not in this browser tab.";
          return (
            <div className="rounded-2xl border border-border/40 bg-card p-5" data-testid="book-processing">
              <AutoRefreshWhileProcessing active />
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${stalled ? "bg-[var(--accent-warning)]" : "bg-[var(--accent-info)]"}`}
                  style={{ width: `${Math.max(2, book.progressPct)}%` }}
                />
              </div>
            </div>
          );
        })()
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
              <div key={lesson.id}>
                <LessonCard lesson={lesson} />
                {/* Sibling, not a child: LessonCard takes no children and it is
                    not my component to widen. The wrapper is conditioned on
                    hasAction — the ULM lead's own predicate, one definition —
                    because the sheet renders nothing without an
                    action_template and cannot suppress a container it does not
                    own. Without the guard, every lesson lacking a proposed
                    action would show an empty bordered row. */}
                {hasAction(lesson.actionTemplate) ? (
                  <div className="mt-3 border-t pt-3">
                    <PromoteLessonSheet
                      lessonId={lesson.id}
                      lessonTitle={lesson.title}
                      actionTemplate={lesson.actionTemplate}
                      areas={promotableAreas}
                      existingPromotion={activePromotions.get(lesson.id) ?? null}
                      // A DISTINCT LABEL, because LessonCard already prints
                      // "Try this" as the heading above the proposed action
                      // (lesson-card.tsx:55). The sheet's default trigger is
                      // also "Try this", so the mount rendered the same two
                      // words twice on one lesson meaning two different
                      // things: one labels the suggestion, one commits to it.
                      // Caught by looking at the 390px capture — the test-id
                      // assertion passed happily, because both existed.
                      trigger={
                        <Button type="button" variant="outline" size="sm" data-testid="promote-lesson-trigger">
                          Commit to this
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {book.status === "ready" && book.lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {book.ingestionMode === "reader" ? "This book is for reading — it has no lesson cards." : "No lessons found for this book yet."}
        </p>
      ) : null}
    </PageContainer>
  );
}
