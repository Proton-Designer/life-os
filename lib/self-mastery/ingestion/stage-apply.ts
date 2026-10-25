import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateLesson, GeneratedCard, EntailmentCheckResult } from "./llm/types";

/**
 * The WRITES of the three model stages (extracting_lessons, generating_cards, verifying_grounding), shared by two callers so there is exactly
 * one definition of what a stage's output looks like in the database:
 *   - the stage handlers in worker-stages.ts (the owner's own AI key), and
 *   - the agent work queue (lib/agent-jobs, kind self_mastery.book_stage), which applies an agent's validated result for one chunk / lesson.
 * Each is IDEMPOTENT per unit (delete-then-insert keyed by the chunk / lesson, or a guarded update), so applying the same unit twice
 * leaves the same rows. They take a service-role client: the unit ids come from the job, never from an agent.
 */

export async function applyExtractedLessons(
  supabase: SupabaseClient,
  args: { bookId: string; chunk: { id: string; sectionId: string | null }; candidates: CandidateLesson[]; paged: boolean },
): Promise<void> {
  const { bookId, chunk, candidates, paged } = args;
  const { error: deleteError } = await supabase
    .from("lessons")
    .delete()
    .eq("source_chunk_id", chunk.id)
    .eq("status", "archived");
  if (deleteError) throw deleteError;

  if (candidates.length > 0) {
    const { error: insertError } = await supabase.from("lessons").insert(
      candidates.map((c) => ({
        book_id: bookId,
        user_id: "00000000-0000-0000-0000-000000000000", // trigger-derived (set_user_id_from_book, 064)
        source_chunk_id: c.sourceChunkId,
        // Every candidate extracted here comes from this ONE chunkRow
        // (extractLessons is called once per chunk, above) -- so all of
        // them inherit that chunk's section_id, not a per-candidate value.
        // Nullable by the same FK (064) that made source_chunk_id nullable:
        // a chunk with no detected section carries section_id: null, and a
        // lesson from it should too, not a guessed value.
        section_id: chunk.sectionId,
        title: c.title,
        core_claim: c.coreClaim,
        mechanism: c.mechanism,
        action_template: c.actionTemplate,
        evidence_strength: c.evidenceStrength,
        provenance_quote: c.provenanceQuote,
        page_ref: paged ? c.pageRef : null,
        status: "archived" as const,
        extracted_by: "model" as const, // 084: a real provider call, not the heuristic or seed paths
      })),
    );
    if (insertError) throw insertError;
  }
}

export async function applyGeneratedCards(
  supabase: SupabaseClient,
  args: { userId: string; bookId: string; lessonId: string; cards: GeneratedCard[] },
): Promise<void> {
  const { userId, bookId, lessonId, cards } = args;
  const { error: deleteError } = await supabase.from("cards").delete().eq("lesson_id", lessonId);
  if (deleteError) throw deleteError;

  if (cards.length > 0) {
    const { data: insertedCards, error: insertError } = await supabase
      .from("cards")
      .insert(
        cards.map((c, i) => ({
          lesson_id: lessonId,
          book_id: bookId,
          user_id: "00000000-0000-0000-0000-000000000000", // trigger-derived (set_user_id_from_book, 065)
          prompt_type: c.promptType,
          prompt: c.prompt,
          answer: c.answer,
          sort_order: i,
        })),
      )
      .select("id");
    if (insertError) throw insertError;

    // THE BUG THIS CLOSES (post-deploy finding, item 5 follow-up): a card
    // with no `card_states` row can never enter `get_session_queue` --
    // BOTH arms (071/126) select FROM card_states, never from cards, so a
    // card this stage creates and never gives a scheduler row to is
    // permanently unstudyable, readable only as inert lesson content.
    // `seed_meditations_deck` (103) has always done this
    // (`insert into card_states (card_id, user_id, book_id, state) values
    // (v_card_id, v_caller, v_book_id, 'new')`) for its seeded decks; this
    // is the real-ingestion path's own version of that exact insert,
    // mirrored column-for-column -- same four columns, same literal 'new'
    // state, no other column touched, so a real-ingested card and a seeded
    // one start scheduling from an identical, verified-correct row shape.
    //
    // WHY HERE, NOT A `finalizingStage` SWEEP: this stage's own delete-
    // then-insert of `cards` (keyed by `lesson_id`, see this function's own
    // header) already makes every card born here CASCADE-fresh on every
    // entry, including a retry of this exact lesson -- `cards`'s FK to
    // `card_states` is `ON DELETE CASCADE` (070), so the delete above has
    // already removed any card_states row a prior, incomplete attempt at
    // THIS lesson may have left behind, before a single new card id exists
    // to collide with. A plain (not upsert) insert is therefore correct,
    // not merely convenient: on the ONLY path that can re-run this stage
    // for an already-advanced lesson (a whole-book `reingest`), the cards
    // above were just deleted and given brand-new ids, so there is no
    // existing card_states row for those ids to conflict with, and no
    // already-reviewed card's row is ever touched -- a reviewed card's
    // history lives under a DIFFERENT card id than whatever this insert
    // just created. Silently upserting here would hide a genuine bug (a
    // stale id somehow reappearing) behind a swallowed conflict; this
    // insert is left to throw, on purpose, matching every other write in
    // this file's fail-closed posture (see `resolveIngestionProvider`'s own
    // header) rather than adding an `ON CONFLICT` this design never needs.
    //
    // `user_id` must be `userId`, explicitly and correctly, not
    // the `cards` insert's zero-UUID placeholder above: `card_states`' own
    // trigger (`card_states_derive_and_check`, 070) derives `book_id` from
    // `card_id` unconditionally, but only OVERWRITES `user_id` when
    // `auth.uid()` is non-null (a real end-user session). Under this
    // worker's service-role client `auth.uid()` is null, so the trigger
    // instead VALIDATES the supplied `user_id` against the card's real
    // owner and raises if it does not match -- a placeholder here would
    // fail closed immediately, not silently misattribute the row.
    if (insertedCards && insertedCards.length > 0) {
      const { error: cardStatesError } = await supabase.from("card_states").insert(
        insertedCards.map((row) => ({
          card_id: row.id,
          user_id: userId,
          book_id: bookId,
          state: "new" as const,
        })),
      );
      if (cardStatesError) throw cardStatesError;
    }
  }

  // D-018: promote iff at least one card survived; a denied lesson keeps
  // its pre-promotion ('archived') status, never touched further here.
  //
  // SCOPING FIX (the Boss's finding): this update was unconditional on
  // `id` alone -- every other write in this file that touches a specific
  // lesson row scopes by `status='archived'` too (extractingLessonsStage's
  // delete, mergingStage's reset), so a promotion here that isn't similarly
  // scoped is the one write in the pipeline that would blindly overwrite
  // whatever state the row is actually in, rather than only ever moving it
  // from the one state this stage is entitled to promote out of.
  if (cards.length > 0) {
    const { error: promoteError } = await supabase
      .from("lessons")
      .update({ status: "active" })
      .eq("id", lessonId)
      .eq("status", "archived");
    if (promoteError) throw promoteError;
  }
}

/** The verdict of one entailment check. Anything but SUPPORTS rejects the lesson (recoverable status, never a delete) and drops its rank. */
export async function applyEntailmentVerdict(
  supabase: SupabaseClient,
  args: { lessonId: string; result: EntailmentCheckResult },
): Promise<void> {
  const { lessonId, result } = args;
  if (result.verdict === "SUPPORTS") return;
  const log = result.verdict === "CONTRADICTS" ? console.error : console.warn;
  log(`[verifying_grounding] lesson ${lessonId} rejected -- verdict=${result.verdict} reason=${JSON.stringify(result.reason).slice(0, 300)}`);

  const { error: rejectError } = await supabase.from("lessons").update({ status: "rejected", rank: null }).eq("id", lessonId).eq("status", "archived");
  if (rejectError) throw rejectError;
}
