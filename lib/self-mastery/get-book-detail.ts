import { cache } from "react";
import { requireUser } from "@/lib/supabase/auth";
import { averageRetrievability, type CardStateForStrength } from "./memory-strength";
import { untypedFrom } from "./untyped-from";
import type { BookDetail, BookDetailLesson, BookStatus, EvidenceStrength, IngestStage, LessonCardState } from "./types";

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
  rank: number | null;
}

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
}

export const getBookDetail = cache(async (bookId: string): Promise<BookDetail | null> => {
  const { supabase, userId } = await requireUser();
  const now = new Date();

  const { data: book, error: bookError } = await untypedFrom(supabase, "books")
    .select("id, title, author, status, stage, progress_pct, error_message, created_at, ready_at")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<BookRow>();
  if (bookError) throw bookError;
  if (!book) return null;

  // Only status='active' lessons — provisional (mid-ingestion, pre-merge)
  // and archived/rejected rows exist but aren't shown, matching ULM's own
  // fetchBookDetail exactly.
  const { data: lessonRows, error: lessonsError } = await untypedFrom(supabase, "lessons")
    .select("id, title, core_claim, mechanism, action_template, evidence_strength, provenance_quote, page_ref, source_chunk_id, rank")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("rank", { ascending: true, nullsFirst: false })
    .returns<LessonRow[]>();
  if (lessonsError) throw lessonsError;
  const lessons = lessonRows ?? [];

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
          .select("card_id, state, stability, difficulty, due_at, reps, lapses, last_review_at")
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
    lessons: detailLessons,
  };
});
