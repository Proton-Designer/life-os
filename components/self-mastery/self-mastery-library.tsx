import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { BookCoverChip } from "./book-cover-chip";
import { MemoryStrengthBar } from "./memory-strength-bar";
import { UploadBookDialog } from "./upload-book-dialog";
import { isIngestionAvailable, INGESTION_UNAVAILABLE_MESSAGE } from "@/lib/self-mastery/ingestion-availability";
import { getSelfMasteryLibrary } from "@/lib/self-mastery/get-library";
import { INGESTION_STAGE_LABEL, bucketIngestStage, looksUnclaimed } from "@/lib/self-mastery/ingestion-stage";
import { hasUsableIngestionKey, ingestionNoKeyMessage } from "@/lib/ai/gateway";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getMostRecentCompletedWeek } from "@/lib/weekly-review/week-range";
import { getUlmWeeklyRecap } from "@/lib/self-mastery/weekly-retention-recap";
import { WeeklyRecapCard } from "./weekly-recap-card";
import { getOverconfidenceVerdict } from "@/lib/self-mastery/get-overconfidence-verdict";
import { OverconfidenceCard } from "./overconfidence-card";
import { getFsrsTuningStatus } from "@/lib/self-mastery/fsrs-tuning";
import { FsrsTuningCard } from "./fsrs-tuning-card";
import { TeachBackPanel } from "./teach-back-panel";
import { SemanticSearchPanel } from "./semantic-search-panel";
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
  const { supabase, userId } = await requireUser();
  const ingestionAvailable = await isIngestionAvailable();
  // Only worth checking once the driver itself is alive -- no point resolving
  // a key for a feature that's unavailable for an unrelated reason, and it
  // keeps the "driver down" message (the more fundamental gap) taking
  // priority over "no key" when both happen to be true at once.
  const keyCheck = ingestionAvailable ? await hasUsableIngestionKey(supabase, userId) : null;
  const canUpload = ingestionAvailable && (keyCheck?.usable ?? false);

  // P2-03's ULM weekly recap -- keyed on the most recently COMPLETED
  // Sun-Sat week (same week-range convention the Weekly Review page uses),
  // not this week so-far, since it's a stored snapshot the weekly cron
  // writes once the week is over (lib/self-mastery/weekly-retention-recap.ts's
  // own header). Null (no row yet, first week ever, or a tick was missed) is
  // a real, silent-absence state -- WeeklyRecapCard renders nothing then,
  // same graceful posture as every other AI/cron-fed panel in this app.
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const weekRange = getMostRecentCompletedWeek(todayStr);
  const weeklyRecap = await getUlmWeeklyRecap(supabase, userId, weekRange.startDate);

  // Phase 2 #P2-08 — overconfidence detector. Cumulative (all-time), not
  // week-scoped -- see lib/self-mastery/get-overconfidence-verdict.ts's
  // own header. Reviews span both self-mastery book cards AND School's
  // Question Bank (card_id vs question_id), so this lives here as the
  // one cross-domain "how well-calibrated is my confidence" panel rather
  // than being duplicated on the School page too.
  const overconfidenceVerdict = await getOverconfidenceVerdict(supabase, userId);

  // P3-20 -- per-user FSRS tuning status. Cross-cutting like
  // OverconfidenceCard above (spans book cards + School's Question Bank
  // reviews), so it lives here rather than being duplicated per surface.
  const fsrsTuningStatus = await getFsrsTuningStatus(supabase, userId);

  return (
    <PageContainer>
      <PageHeader title="Self-Mastery" description="Reading, learning, spaced review." actions={books.length > 0 && canUpload ? <UploadBookDialog /> : null} />

      {books.length > 0 ? <SemanticSearchPanel /> : null}
      <WeeklyRecapCard recap={weeklyRecap} />
      <OverconfidenceCard verdict={overconfidenceVerdict} />
      <FsrsTuningCard status={fsrsTuningStatus} />
      {/* P2-18 -- own book/lesson picker, doesn't need the fully-shaped
          LibraryBook rows this page already fetched, just id/title of
          ready books (a teach-back target needs real lessons, and only a
          "ready" book has any). */}
      <TeachBackPanel books={books.filter((b) => b.status === "ready").map((b) => ({ id: b.id, title: b.title }))} />

      {books.length === 0 ? (
        // Not the generic EmptyState primitive — its action contract is a
        // plain href/onClick, and this action needs to open the upload
        // dialog (with its own file-pick/title/author flow), not navigate
        // or fire a bare callback. Same visual shape (icon, message,
        // centered action), just with UploadBookDialog's real trigger.
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <BookOpen className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
          {canUpload ? (
            <>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upload a PDF and Self-Mastery turns it into a set of grounded lesson cards you can actually retain.
              </p>
              <UploadBookDialog trigger={<Button size="sm" variant="outline">Add a book</Button>} />
            </>
          ) : (
            // No worker consumes `ingestion_jobs` yet, so an upload would sit
            // at "processing" forever. Say so plainly rather than offering a
            // button that eats the file — an absent feature is a gap, a broken
            // promise reads as a broken app.
            <p className="max-w-xs text-sm text-muted-foreground">
              {ingestionAvailable ? ingestionNoKeyMessage(keyCheck?.providerLabel) : INGESTION_UNAVAILABLE_MESSAGE}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <Link
              key={book.id}
              // Canonical, mode-independent URL (see app/(app)/self-mastery/
              // and get-in-progress-books.ts's own comment) -- NOT
              // /personal/self_mastery/${book.id}. This component renders at
              // BOTH /personal/self_mastery (domains mode, via the Personal
              // tab) and /self-mastery (legacy mode, via sidebar-nav.tsx, and
              // domains mode by direct URL) — a hardcoded /personal/* link
              // here would 404/redirect every legacy-mode viewer the moment
              // they tried to open a book from this exact grid, which is
              // precisely the S6 bug this pass exists to close.
              href={`/self-mastery/${book.id}`}
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
