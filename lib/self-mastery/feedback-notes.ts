import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { briefSourceLabel } from "@/lib/morning-brief/brief-source";

/**
 * Feedback an agent attached to something the person wrote earlier (migration 280): written feedback on a typed card answer, or a
 * teach-back evaluation of a lesson. Shown the next time the card / lesson is opened. NEVER a gate: nothing here touches a rating,
 * a review or a schedule, and a suggested rating is only ever displayed. Display-only, so a read failure reads as nothing.
 */

export interface FeedbackNoteView {
  id: string;
  /** What the person wrote then (their answer / explanation). */
  attempt: string;
  feedback: string;
  suggestedRating: number | null;
  followUpQuestions: string[];
  sourceLabel: string | null;
  createdAt: string;
  isNew: boolean;
}

export interface FeedbackState {
  notes: FeedbackNoteView[];
  /** A request is queued or being worked on by the agent right now. */
  pending: boolean;
}

const LIVE = ["pending", "claimed", "applying"];

export async function getFeedbackState(
  supabase: SupabaseClient,
  userId: string,
  args: { subjectType: "card" | "lesson"; subjectId: string },
): Promise<FeedbackState> {
  try {
    const column = args.subjectType === "card" ? "card_id" : "lesson_id";
    const [{ data: noteRows }, { data: jobRows }] = await Promise.all([
      supabase
        .from("ai_feedback_notes")
        .select("id, kind, attempt_text, feedback_text, suggested_rating, follow_up_questions, provider, model, seen_at, created_at")
        .eq("user_id", userId)
        .eq(column, args.subjectId)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("agent_jobs")
        .select("id, status, created_at")
        .eq("user_id", userId)
        .eq("subject_id", args.subjectId)
        .in("status", LIVE)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const notes = ((noteRows ?? []) as Record<string, unknown>[]).map((n) => ({
      id: n.id as string,
      attempt: n.attempt_text as string,
      feedback: n.feedback_text as string,
      suggestedRating: (n.suggested_rating as number | null) ?? null,
      followUpQuestions: Array.isArray(n.follow_up_questions) ? (n.follow_up_questions as string[]) : [],
      sourceLabel: briefSourceLabel(n.provider as string | null, n.model as string | null),
      createdAt: n.created_at as string,
      isNew: n.seen_at === null || n.seen_at === undefined,
    }));
    return { notes, pending: Array.isArray(jobRows) && jobRows.length > 0 };
  } catch {
    return { notes: [], pending: false };
  }
}

/** The notes were shown: stop highlighting them as new. Bookkeeping only; failures are ignored. */
export async function markFeedbackNotesSeen(supabase: SupabaseClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => Promise.resolve(supabase.rpc("mark_feedback_note_seen", { p_id: id })).catch(() => {})));
}
