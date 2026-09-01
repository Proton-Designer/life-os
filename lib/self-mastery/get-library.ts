import { cache } from "react";
import { requireUser } from "@/lib/supabase/auth";
import { averageRetrievability, type CardStateForStrength } from "./memory-strength";
import { untypedFrom } from "./untyped-from";
import type { LibraryBook, BookStatus, IngestStage } from "./types";

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  stage: IngestStage;
  progress_pct: number;
  lesson_count: number;
  cover_hue: number | null;
  created_at: string;
  ready_at: string | null;
  error_message: string | null;
}

interface CardRow {
  id: string;
  book_id: string;
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

export const getSelfMasteryLibrary = cache(async (): Promise<LibraryBook[]> => {
  const { supabase, userId } = await requireUser();
  const now = new Date();

  const { data: bookRows, error: booksError } = await untypedFrom(supabase, "books")
    .select("id, title, author, status, stage, progress_pct, lesson_count, cover_hue, created_at, ready_at, error_message")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<BookRow[]>();
  if (booksError) throw booksError;

  const books = bookRows ?? [];
  if (books.length === 0) return [];

  // One query for every card across every book, one for every card_state —
  // avoids an N+1 per book. Memory strength is computed from THIS data, not
  // a separate RPC (see memory-strength.ts's header — the SQL RPC this
  // would otherwise call is retired, not just unused).
  const bookIds = books.map((b) => b.id);
  const { data: cardRows, error: cardsError } = await untypedFrom(supabase, "cards")
    .select("id, book_id")
    .eq("user_id", userId)
    .in("book_id", bookIds)
    .returns<CardRow[]>();
  if (cardsError) throw cardsError;

  const cardIds = (cardRows ?? []).map((c) => c.id);
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
  const cardsByBookId = new Map<string, CardRow[]>();
  for (const c of cardRows ?? []) {
    const list = cardsByBookId.get(c.book_id) ?? [];
    list.push(c);
    cardsByBookId.set(c.book_id, list);
  }

  return books.map((b) => {
    const bookCards = cardsByBookId.get(b.id) ?? [];
    const cardStates: (CardStateForStrength | null)[] = bookCards.map((c) => {
      const row = stateByCardId.get(c.id);
      if (!row) return null;
      return {
        state: row.state,
        stability: row.stability,
        difficulty: row.difficulty,
        dueAt: row.due_at,
        reps: row.reps,
        lapses: row.lapses,
        lastReviewAt: row.last_review_at,
      };
    });

    return {
      id: b.id,
      title: b.title,
      author: b.author,
      status: b.status,
      stage: b.stage,
      progressPct: b.progress_pct,
      lessonCount: b.lesson_count,
      coverHue: b.cover_hue,
      createdAt: b.created_at,
      readyAt: b.ready_at,
      errorMessage: b.error_message,
      memoryStrength: averageRetrievability(cardStates, now),
    };
  });
});
