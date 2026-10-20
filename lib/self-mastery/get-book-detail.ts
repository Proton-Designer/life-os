import { cache } from "react";
import { requireUser } from "@/lib/supabase/auth";
import { averageRetrievability, type CardStateForStrength } from "./memory-strength";
import { untypedFrom } from "./untyped-from";
import { looksStalled } from "./ingestion-stage";
import { canOpenInReader, toReadProgress, type BookDetail, type BookDetailLesson, type BookStatus, type EvidenceStrength, type IngestStage, type LessonCardState, type ReaderStatus } from "./types";

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  stage: IngestStage;
  progress_pct: number;
  error_message: string | null;
  created_at: string;
  ready_at: string | null;
  ingestion_mode: string;
  reader_status: ReaderStatus;
  reader_word_count: number | null;
  file_path: string | null;
}

interface LessonRow {
  id: string;
  title: string;
  core_claim: string | null;
  mechanism: string | null;
  action_template: string | null;
  evidence_strength: EvidenceStrength | null;
  provenance_quote: string;
  page_ref: number | null;
  source_chunk_id: string | null;
  section_id: string | null;
  rank: number | null;
}

interface BookSectionRow {
  id: string;
  title: string | null;
}

// The honest "nothing detected" sentinel `parseStructure`
// (lib/self-mastery/ingestion/structure.ts) writes when neither the PDF's
// own outline nor the heading heuristic found real structure. Never shown
// as a chapter -- see BookDetailLesson.sectionTitle's own header for why.
const NO_REAL_STRUCTURE_SENTINEL = "Full Book";

interface CardRow {
  id: string;
  lesson_id: string;
  prompt_type: "free_recall" | "application" | "cloze" | "why";
}

interface CardStateRow {
  card_id: string;
  state: "new" | "learning" | "review" | "relearning";
  stability: number | null;
  difficulty: number | null;
  due_at: string | null;
  reps: number;
  lapses: number;
  last_review_at: string | null;
  learning_steps: number;
}

export const getBookDetail = cache(async (bookId: string): Promise<BookDetail | null> => {
  const { supabase, userId } = await requireUser();
  const now = new Date();

  const { data: book, error: bookError } = await untypedFrom(supabase, "books")
    .select("id, title, author, status, stage, progress_pct, error_message, created_at, ready_at, ingestion_mode, reader_status, reader_word_count, file_path")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<BookRow>();
  if (bookError) throw bookError;
  if (!book) return null;

  // "Claimed but stopped moving" (S6, 2026-09-14) -- ingestion_jobs.updated_at
  // is bumped by ingestion_jobs_touch_updated_at on every claim/advance/fail
  // write, so its age against `now` IS the real "how long since anything
  // happened to this job" answer, not a proxy for it (see looksStalled's own
  // header). Only meaningful while the book is still mid-pipeline -- skipped
  // for ready/failed, where "stalled" is a meaningless question. A book with
  // no ingestion_jobs row at all (a seeded starter deck predating the real
  // pipeline) reads as not-stalled via looksStalled's own null handling,
  // never fabricated.
  let jobUpdatedAt: Date | null = null;
  if (book.status !== "ready" && book.status !== "failed") {
    const { data: jobRow, error: jobError } = await untypedFrom(supabase, "ingestion_jobs")
      .select("updated_at")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle()
      .returns<{ updated_at: string } | null>();
    if (jobError) throw jobError;
    jobUpdatedAt = jobRow ? new Date(jobRow.updated_at) : null;
  }

  const { data: position } = await supabase
    .from("reader_positions")
    .select("word_index, client_updated_at")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .maybeSingle();

  // Only status='active' lessons — provisional (mid-ingestion, pre-merge)
  // and archived/rejected rows exist but aren't shown, matching ULM's own
  // fetchBookDetail exactly.
  const { data: lessonRows, error: lessonsError } = await untypedFrom(supabase, "lessons")
    .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id, section_id, rank")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("rank", { ascending: true, nullsFirst: false })
    .returns<LessonRow[]>();
  if (lessonsError) throw lessonsError;
  const lessons = lessonRows ?? [];

  // Batched, not per-lesson: a handful of section ids shared across dozens
  // of lessons, same "one query for the whole book" posture as cards/
  // card_states below. Skipped entirely when no lesson has a section_id —
  // an empty `.in()` list is a real, distinct query worth not sending.
  const sectionIds = [...new Set(lessons.map((l) => l.section_id).filter((id): id is string => id !== null))];
  const { data: sectionRows, error: sectionsError } =
    sectionIds.length > 0
      ? await untypedFrom(supabase, "book_sections").select("id, title").in("id", sectionIds).returns<BookSectionRow[]>()
      : { data: [] as BookSectionRow[], error: null };
  if (sectionsError) throw sectionsError;
  const sectionTitleById = new Map((sectionRows ?? []).map((s) => [s.id, s.title]));

  // Real title only. Collapses to null for: no section_id, a section row
  // with no title, and the NO_REAL_STRUCTURE_SENTINEL -- never a guess, per
  // BookDetailLesson.sectionTitle's own header.
  const resolveSectionTitle = (sectionId: string | null): string | null => {
    if (sectionId === null) return null;
    const title = sectionTitleById.get(sectionId);
    if (!title || title === NO_REAL_STRUCTURE_SENTINEL) return null;
    return title;
  };

  const { data: cardRows, error: cardsError } = await untypedFrom(supabase, "cards")
    .select("id, lesson_id, prompt_type")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .returns<CardRow[]>();
  if (cardsError) throw cardsError;
  const cards = cardRows ?? [];

  const cardIds = cards.map((c) => c.id);
  const { data: stateRows, error: statesError } =
    cardIds.length > 0
      ? await untypedFrom(supabase, "card_states")
          .select("card_id, state, stability, difficulty, due_at, reps, lapses, last_review_at, learning_steps")
          .eq("user_id", userId)
          .in("card_id", cardIds)
          .returns<CardStateRow[]>()
      : { data: [] as CardStateRow[], error: null };
  if (statesError) throw statesError;

  const stateByCardId = new Map((stateRows ?? []).map((s) => [s.card_id, s]));
  const toCardStateForStrength = (row: CardStateRow | undefined): CardStateForStrength | null =>
    row
      ? {
          state: row.state,
          stability: row.stability,
          difficulty: row.difficulty,
          dueAt: row.due_at,
          reps: row.reps,
          lapses: row.lapses,
          lastReviewAt: row.last_review_at,
          learningSteps: row.learning_steps,
        }
      : null;

  // Book-level strength is the mean across EVERY card in the book — the
  // same function, same live rows, just the widest slice. Deliberately not
  // an average-of-lesson-averages (that would silently reweight lessons
  // with fewer cards) — this is what keeps the book bar and the sum of its
  // lessons' bars mutually consistent rather than two numbers that merely
  // happen to agree today.
  const allCardStates = cards.map((c) => toCardStateForStrength(stateByCardId.get(c.id)));
  const bookMemoryStrength = averageRetrievability(allCardStates, now);

  const cardsByLessonId = new Map<string, CardRow[]>();
  for (const c of cards) {
    const list = cardsByLessonId.get(c.lesson_id) ?? [];
    list.push(c);
    cardsByLessonId.set(c.lesson_id, list);
  }

  const detailLessons: BookDetailLesson[] = lessons.map((l) => {
    const lessonCards = cardsByLessonId.get(l.id) ?? [];
    const lessonCardStates = lessonCards.map((c) => toCardStateForStrength(stateByCardId.get(c.id)));
    const perCard: LessonCardState[] = lessonCards.map((c) => {
      const row = stateByCardId.get(c.id);
      return {
        cardId: c.id,
        promptType: c.prompt_type,
        state: row?.state ?? "new",
        stability: row?.stability ?? null,
        lastReviewAt: row?.last_review_at ?? null,
        learningSteps: row?.learning_steps ?? 0,
      };
    });

    return {
      id: l.id,
      title: l.title,
      coreClaim: l.core_claim,
      mechanism: l.mechanism,
      actionTemplate: l.action_template,
      evidenceStrength: l.evidence_strength,
      provenanceQuote: l.provenance_quote,
      pageRef: l.page_ref,
      sourceChunkId: l.source_chunk_id,
      sectionTitle: resolveSectionTitle(l.section_id),
      memoryStrength: averageRetrievability(lessonCardStates, now),
      cards: perCard,
    };
  });

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    status: book.status,
    stage: book.stage,
    progressPct: book.progress_pct,
    errorMessage: book.error_message,
    createdAt: book.created_at,
    readyAt: book.ready_at,
    memoryStrength: bookMemoryStrength,
    ingestionMode: book.ingestion_mode,
    readerStatus: book.reader_status,
    readerWordCount: book.reader_word_count,
    canRead: canOpenInReader({ readerStatus: book.reader_status, status: book.status, hasFile: book.file_path != null }),
    readProgress: toReadProgress(position ?? undefined, book.reader_word_count),
    lessons: detailLessons,
    looksStalled: looksStalled(book.stage, jobUpdatedAt, now),
  };
});
