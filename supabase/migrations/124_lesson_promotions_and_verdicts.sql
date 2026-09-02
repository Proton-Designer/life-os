-- 124: the loop seam's data model — Phase C, R30/R64.
--
-- WHAT THIS CLOSES. Every ULM lesson carries `action_template` ("claim-to-task:
-- a concrete behaviour to try"), populated on every row and rendered nowhere.
-- The merge exists to turn that string into a real commitment whose effect can
-- be judged. This migration is the data for that: a promotion is the
-- commitment, and a verdict is the judgement.
--
-- SHAPE, AND WHY IT MIRRORS R1. A current-state row (`lesson_promotions`) plus
-- an APPEND-ONLY log (`lesson_verdicts`) — deliberately the same shape as
-- `card_states` over `reviews`, so this is consistent with the engine rather
-- than a second pattern. "Still testing" means a verdict is given and later
-- revised; a mutable verdict column would launder that history.
--
-- SCOPE — R64. This file is ADDITIVE ONLY and touches nothing on the daily
-- session's path. "Adopted lessons leave the deck" is NOT delivered here and
-- must not be claimed until `125` proves it: the suspension mechanism ULM had
-- (`cards.suspended_at` + a trigger + a `get_session_queue` filter) was never
-- ported, so adding `adopted` to the enum changes what a row can SAY, not what
-- the queue DOES. Adding the enum value here is what lets 125 be a small,
-- isolated change to the hot path.
--
-- Transaction control is the RUNNER's (R33) — no begin/commit in this file.

-- ── 1. Verdict vocabulary ───────────────────────────────────────────────────
create type public.lesson_verdict as enum ('adopted', 'abandoned', 'still_testing');

-- `adopted` on lesson_status is NOT added here. `ALTER TYPE ... ADD VALUE`
-- cannot run inside a transaction block, and this file is otherwise atomic —
-- two tables, five indexes, four triggers and an FK. Running the whole thing
-- with --no-transaction to accommodate one statement would re-create exactly
-- the half-applied hazard that put `111` on production in pieces.
--
-- The runner REFUSED this file when the statement was here (R33's guard,
-- working), which is what forced the split rather than anyone noticing it.
-- The enum value ships in its own single-statement --no-transaction migration
-- ahead of `125`, which is the change that actually gives the value behaviour.
-- Mechanically `archived` would have worked; they are different facts —
-- `archived` already means "lost the merge", and "you now do this" is the
-- literal distinction the return arc queries on.

-- ── 2. lesson_promotions — the promotion IS the commitment (R30) ────────────
create table if not exists public.lesson_promotions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  lesson_id       uuid not null,
  area_id         uuid not null,

  -- NOT NULL, and never a copy of `lessons.action_template`. This is the text
  -- the USER accepted, and the confirm step that produces it is §8.9's rule
  -- made structural: you cannot create a promotion without it. Keeping it
  -- separate preserves the distinction between what the model proposed and
  -- what a human agreed to — overwrite the lesson and `extracted_by`'s
  -- provenance becomes unauditable at the one moment it matters.
  accepted_text   text not null check (length(btrim(accepted_text)) > 0),

  cadence         text null,
  cue             text null,

  started_at      timestamptz not null default now(),

  -- A PARAMETER, not a formula. Defaulted to +30 days and free to differ per
  -- promotion (a two-week experiment, a ninety-day one). If it were always
  -- exactly started_at + 30 days it would be a derived column able to disagree
  -- with its own definition, which is the `book_memory_strength` hazard in
  -- miniature.
  verdict_due_at  timestamptz not null default (now() + interval '30 days'),

  -- Derived, single-writer, and it ships WITH its instrument (R64):
  -- check-retired-at-drift.sh asserts retired_at is non-null IFF a terminal
  -- verdict exists. Written only by trg_retire_promotion_on_terminal_verdict
  -- below — never by a client. No check, no column.
  retired_at      timestamptz null,

  created_at      timestamptz not null default now(),

  -- Tenancy-safe composite FKs. A single-column FK to id alone validates every
  -- row while leaving a cross-tenant promotion perfectly representable; both
  -- targets already carry a (user_id, id) unique index, checked before writing
  -- this file rather than assumed (123 had to create its own).
  foreign key (user_id, lesson_id) references public.lessons (user_id, id) on delete cascade,
  foreign key (user_id, area_id)   references public.user_domains (user_id, id) on delete cascade
);

-- One ACTIVE promotion per lesson per user. A retired one may be superseded.
create unique index if not exists lesson_promotions_active_per_lesson
  on public.lesson_promotions (user_id, lesson_id) where retired_at is null;

-- The (user_id, id) target this table's own children need — the 058 trick,
-- redundant with the primary key, existing solely to be referencable.
create unique index if not exists lesson_promotions_user_id_id_key
  on public.lesson_promotions (user_id, id);

create index if not exists lesson_promotions_due_idx
  on public.lesson_promotions (user_id, verdict_due_at) where retired_at is null;

-- ── 3. lesson_verdicts — append-only judgement log ──────────────────────────
create table if not exists public.lesson_verdicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  promotion_id  uuid not null,
  verdict       public.lesson_verdict not null,

  -- A negative verdict without its reason is indistinguishable from neglect.
  reason        text null,
  verdict_at    timestamptz not null default now(),

  constraint lesson_verdicts_abandoned_needs_reason
    check (verdict <> 'abandoned' or (reason is not null and length(btrim(reason)) > 0)),

  foreign key (user_id, promotion_id)
    references public.lesson_promotions (user_id, id) on delete cascade
);

create index if not exists lesson_verdicts_promotion_idx
  on public.lesson_verdicts (promotion_id, verdict_at desc);

-- ── 4. Ownership: user_id comes from the caller, never from client input ────
create trigger lesson_promotions_set_user_id
  before insert on public.lesson_promotions
  for each row execute function public.set_user_id_from_caller();

create trigger lesson_verdicts_set_user_id
  before insert on public.lesson_verdicts
  for each row execute function public.set_user_id_from_caller();

-- ── 5. Append-only, mirroring reviews (072). No role exemption. ─────────────
create or replace function public.reject_lesson_verdict_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'lesson_verdicts is append-only (attempted %)', tg_op;
end;
$$;

create trigger lesson_verdicts_no_update
  before update or delete on public.lesson_verdicts
  for each row execute function public.reject_lesson_verdict_mutation();

-- ── 6. retired_at's single writer ───────────────────────────────────────────
-- `still_testing` is NOT terminal — that is the whole reason the log exists
-- separately from the row.
create or replace function public.retire_promotion_on_terminal_verdict()
returns trigger
language plpgsql
as $$
begin
  if new.verdict in ('adopted', 'abandoned') then
    update public.lesson_promotions
       set retired_at = coalesce(retired_at, new.verdict_at)
     where id = new.promotion_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger trg_retire_promotion_on_terminal_verdict
  after insert on public.lesson_verdicts
  for each row execute function public.retire_promotion_on_terminal_verdict();

-- ── 7. Close 123's deliberately open end ────────────────────────────────────
-- 123 shipped work_sessions.promotion_id nullable and FK-LESS because this
-- table did not exist; until now only application code stopped a dangling id.
alter table public.work_sessions
  add constraint work_sessions_promotion_fkey
  foreign key (user_id, promotion_id)
  references public.lesson_promotions (user_id, id) on delete set null;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
alter table public.lesson_promotions enable row level security;
alter table public.lesson_verdicts   enable row level security;

create policy lesson_promotions_own_row on public.lesson_promotions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lesson_verdicts_own_row on public.lesson_verdicts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.lesson_promotions is
  'A lesson''s action_template accepted by the user as a real commitment (R30: the promotion IS the commitment, a fourth lifecycle beside dated/open-ended/recurring). accepted_text is the user''s own wording and never overwrites lessons.action_template. retired_at is written ONLY by trg_retire_promotion_on_terminal_verdict and is guarded by check-retired-at-drift.sh.';

comment on table public.lesson_verdicts is
  'Append-only judgement log over lesson_promotions (same shape as reviews over card_states). still_testing is non-terminal by design; adopted and abandoned retire the promotion via trigger.';
