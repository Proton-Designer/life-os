-- 123 — the polymorphic session→commitment binding (R30, B3).
--
-- A Deep Work session can be EVIDENCE for a commitment. R30 rules there is no
-- unified commitments table: the session carries per-kind nullable FK columns,
-- so evidence accrues to a lesson promotion exactly the way it does to a
-- kill-list item, and a fourth lifecycle can be added without reshaping the
-- three that exist.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE CHECK IS `<= 1`, NOT `= 1`. R30's text says "the num_nonnulls = 1
-- pattern", and that phrase describes the codebase's existing XOR constraints
-- (e.g. `reviews_item_xor`), where a review MUST reference exactly one item.
-- A session is different: MOST SESSIONS SERVE NO COMMITMENT. Someone sits down
-- and works. `= 1` would make every unbound session illegal — which is not a
-- constraint, it is a product change nobody asked for, and it would fail on the
-- next session anyone starts.
--
-- This is the same distinction the read path already draws
-- (lib/commitments/binding.ts): unbound resolves to null and is NOT an error;
-- two bindings IS an error. `<= 1` is exactly that, expressed in SQL. Raised
-- rather than implemented literally, because implementing the sentence would
-- have shipped a constraint that breaks ordinary use.
-- ─────────────────────────────────────────────────────────────────────────
--
-- COMPOSITE FK TARGETS DID NOT EXIST AND ARE CREATED HERE. A tenancy-safe FK
-- references `(user_id, id)`, which makes a cross-tenant row unrepresentable
-- rather than merely forbidden — the pattern `058` established for `classes`.
-- Neither `kill_list_items` nor `rep_goals` had a `(user_id, id)` unique index,
-- so the FKs had no target. Checked before writing rather than discovered at
-- apply time. The indexes are redundant with each primary key (`id` is already
-- unique, so the pair trivially is) and exist solely to be referencable.
--
-- `promotion_id` IS DELIBERATELY UNCONSTRAINED FOR NOW. `lesson_promotions`
-- does not exist — it is the ULM lead's Phase C design — so its FK cannot be
-- created yet. The column ships nullable and FK-less rather than being left out
-- entirely, so the read path (already written and tested) has a real column to
-- read and Phase C adds one constraint instead of a column plus a backfill.
-- The tradeoff is stated rather than hidden: until that FK exists, a
-- promotion_id can hold an id that references nothing, and only application
-- code prevents it.
--
-- No `begin;`/`commit;` — the runner owns the transaction.

create unique index if not exists kill_list_items_user_id_id_key
  on public.kill_list_items (user_id, id);

create unique index if not exists rep_goals_user_id_id_key
  on public.rep_goals (user_id, id);

alter table public.work_sessions
  add column kill_list_item_id uuid null,
  add column rep_goal_id uuid null,
  add column promotion_id uuid null;

alter table public.work_sessions
  add constraint work_sessions_kill_list_item_fkey
  foreign key (user_id, kill_list_item_id)
  references public.kill_list_items (user_id, id) on delete set null;

alter table public.work_sessions
  add constraint work_sessions_rep_goal_fkey
  foreign key (user_id, rep_goal_id)
  references public.rep_goals (user_id, id) on delete set null;

-- At most one. See the header: `= 1` would outlaw ordinary work.
alter table public.work_sessions
  add constraint work_sessions_commitment_binding_check
  check (num_nonnulls(kill_list_item_id, rep_goal_id, promotion_id) <= 1);

comment on column public.work_sessions.kill_list_item_id is
  'Evidence binding (R30). NULL means this session served no commitment -- a real state, not missing data. At most one of the three binding columns is non-null.';

do $$
declare
  v_def text;
  v_fks int;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'work_sessions'
         and column_name in ('kill_list_item_id', 'rep_goal_id', 'promotion_id')) <> 3 then
    raise exception 'migration 123: expected all three binding columns on work_sessions';
  end if;

  -- Assert the CHECK's PREDICATE, not its existence. A constraint present but
  -- written `>= 0` would satisfy every existence-style check while permitting
  -- a session bound to three commitments at once.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'work_sessions_commitment_binding_check';
  if v_def is null then
    raise exception 'migration 123: binding CHECK is absent';
  end if;
  if v_def not like '%<= 1%' then
    raise exception 'migration 123: binding CHECK is not the at-most-one predicate: %', v_def;
  end if;

  -- Both composite FKs must exist AND be composite. A single-column FK to
  -- `id` alone would validate every row while leaving a cross-tenant binding
  -- perfectly representable, which is the whole point of the pattern.
  select count(*) into v_fks
    from pg_constraint
   where conrelid = 'public.work_sessions'::regclass
     and contype = 'f'
     and conname in ('work_sessions_kill_list_item_fkey', 'work_sessions_rep_goal_fkey')
     and array_length(conkey, 1) = 2;
  if v_fks <> 2 then
    raise exception 'migration 123: expected 2 two-column composite FKs, found %', v_fks;
  end if;

  raise notice 'migration 123 verified: three binding columns, at-most-one CHECK, 2 composite FKs (promotion FK deferred to Phase C)';
end $$;
