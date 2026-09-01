-- ULM: `seed_meditations_deck` — the RPC that wires the D-018 seeded deck into
-- onboarding completion. The sixth instance of the mechanism-with-no-caller
-- shape found today (lessons.embedding, book_milestone, reviews.confidence,
-- and now this): `seedMeditationsDeck` (packages/core/src/seed/, ULM repo)
-- was built, idempotent, verified end-to-end against a real throwaway user —
-- and never invoked by anything in the app. Production has zero cards.
--
-- WHY AN RPC, NOT A SEQUENCE OF CLIENT-SIDE .insert() CALLS: the ULM-repo
-- version drives raw `pg` and fakes auth.uid() via
-- set_config('request.jwt.claim.sub', ...) because it has no real caller
-- session. In a Server Action the auth context is REAL (requireUser()'s
-- Supabase client already carries the signed-in user's JWT) -- but each
-- separate PostgREST request (each .insert() call) is its own transaction,
-- so a `pg_advisory_xact_lock` taken in one call would already be released
-- before the next call runs. One RPC call is one transaction: the lock, the
-- idempotency check, the self_mastery gate, and every insert happen
-- atomically together, the same reason submit_review/start_session/
-- complete_session are RPCs and not client-side insert sequences.
--
-- CONTENT STAYS IN TYPESCRIPT, NOT HARDCODED HERE: this function takes the
-- deck as a jsonb PARAMETER, built by a TS helper (packages/core, ULM repo)
-- from the real MEDITATIONS_DECK fixture + generateCardsForLesson() +
-- meditations-chunks.ts -- the exact same D-018 content and card-generation
-- code already verified against the real production gates. Re-authoring 12
-- lessons' worth of quotes and cards as literal SQL INSERT statements would
-- reintroduce the transcription risk that whole deck's discipline exists to
-- eliminate. This migration is the write PATH; the content lives in TS.
--
-- IDEMPOTENT, and this now matters more than it did on the ULM-repo version:
-- onboarding completion gets retried (network hiccup, refresh, back button).
-- A double-seed gives a user two independent copies of every card with
-- independent FSRS state -- no error, no constraint violation, just a queue
-- silently twice as long and a memory-strength denominator quietly wrong.
-- Guarded two ways, same design as the ULM-repo version: a transaction-
-- scoped advisory lock keyed on the caller (serializes a genuinely
-- concurrent double-call) plus an existence check inside that lock (the
-- ordinary sequential-retry case).
--
-- SELF-MASTERY GATE LIVES HERE, NOT AT THE CALL SITE (9fh3zave's call,
-- correctly): the caller (`completeOnboarding`) has no reason to know
-- Self-Mastery's internal shape or which subdomain key represents it --
-- it calls this RPC unconditionally, and this RPC is a documented no-op
-- for anyone who didn't keep 'self_mastery'. Race-free: reads the same
-- `user_subdomains` row `saveSubdomains` actually persisted, inside this
-- transaction, not a value the caller snapshotted earlier and might be
-- stale by the time onboarding completes.
--
-- extracted_by = 'seed' throughout (084) -- hand-authored, hand-verified,
-- neither ingestion generator produced these rows.
create function public.seed_meditations_deck(p_lessons jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_caller uuid := auth.uid();
  v_deck_title text := 'Meditations (Marcus Aurelius) — Starter Deck';
  v_has_self_mastery boolean;
  v_book_id uuid;
  v_lesson_count int := 0;
  v_card_count int := 0;
  v_lesson jsonb;
  v_card jsonb;
  v_lesson_id uuid;
  v_chunk_id uuid;
  v_card_id uuid;
  v_sort_idx int := 0;
begin
  if v_caller is null then
    raise exception 'seed_meditations_deck: no authenticated user';
  end if;

  -- Serializes concurrent calls for the SAME user (e.g. a retried onboarding
  -- completion racing the original). hashtext() on a fixed per-user string
  -- keeps this deck's lock key independent of any other advisory lock this
  -- schema might use.
  perform pg_advisory_xact_lock(hashtext('seed-meditations-deck:' || v_caller::text));

  select exists(
    select 1 from public.user_subdomains
    where user_id = v_caller and key = 'self_mastery' and archived_at is null
  ) into v_has_self_mastery;

  if not v_has_self_mastery then
    return jsonb_build_object('seeded', false, 'reason', 'self_mastery_not_selected');
  end if;

  select id into v_book_id from public.books
    where user_id = v_caller and title = v_deck_title
    limit 1;

  if v_book_id is not null then
    select count(*) into v_lesson_count from public.lessons where book_id = v_book_id;
    select count(*) into v_card_count from public.cards where book_id = v_book_id;
    return jsonb_build_object(
      'seeded', true, 'alreadySeeded', true, 'bookId', v_book_id,
      'lessonCount', v_lesson_count, 'cardCount', v_card_count
    );
  end if;

  insert into public.books (title, author, status, stage, progress_pct, ready_at)
    values (v_deck_title, 'Marcus Aurelius', 'ready', 'done', 100, now())
    returning id into v_book_id;

  for v_lesson in select * from jsonb_array_elements(p_lessons)
  loop
    insert into public.source_chunks (book_id, text, page_start, page_end, sort_order)
      values (
        v_book_id,
        v_lesson->>'chunkText',
        (v_lesson->>'pageRef')::int,
        (v_lesson->>'pageRef')::int,
        v_sort_idx
      )
      returning id into v_chunk_id;

    insert into public.lessons (
      book_id, source_chunk_id, title, core_claim, mechanism, action_template,
      evidence_strength, provenance_quote, page_ref, status, extracted_by
    ) values (
      v_book_id, v_chunk_id,
      v_lesson->>'title', v_lesson->>'coreClaim', v_lesson->>'mechanism', v_lesson->>'actionTemplate',
      (v_lesson->>'evidenceStrength')::public.evidence_strength,
      v_lesson->>'provenanceQuote', (v_lesson->>'pageRef')::int,
      'active', 'seed'
    ) returning id into v_lesson_id;

    for v_card in select * from jsonb_array_elements(v_lesson->'cards')
    loop
      insert into public.cards (lesson_id, book_id, prompt_type, prompt, answer, sort_order)
        values (
          v_lesson_id, v_book_id,
          (v_card->>'promptType')::public.prompt_type,
          v_card->>'prompt', v_card->>'answer',
          (v_card->>'sortOrder')::int
        )
        returning id into v_card_id;

      insert into public.card_states (card_id, user_id, book_id, state)
        values (v_card_id, v_caller, v_book_id, 'new');

      v_card_count := v_card_count + 1;
    end loop;

    v_lesson_count := v_lesson_count + 1;
    v_sort_idx := v_sort_idx + 1;
  end loop;

  update public.books set lesson_count = v_lesson_count where id = v_book_id;

  return jsonb_build_object(
    'seeded', true, 'alreadySeeded', false, 'bookId', v_book_id,
    'lessonCount', v_lesson_count, 'cardCount', v_card_count
  );
end;
$$;
