-- ULM: `self_explanations` — ungraded by design. `response` is nullable: a
-- skip stores null and is never penalised. The brief is explicit that
-- generating the explanation IS the intervention; there is no scoring path
-- here and none should be added.
--
-- `session_id` references `public.work_sessions(id)`, not ULM's old
-- `sessions` — same situation as `reviews` (072): the FK resolves today,
-- but no self-explanation can actually carry a `learn`-kind session until
-- the work_sessions widening lands.
--
-- Two triggers, both ported, sourced from grepping every ULM migration that
-- touches this table (not just the base schema):
-- 1. `set_user_id_from_caller` (reused from 061_ulm_books.sql) — caller-
--    owned, same as `books`.
-- 2. `check_self_explanation_owner`, from
--    `20260815041000_l1a_fix_cross_owner_ref.sql` — a real gap the base
--    schema shipped with: forcing user_id from the caller satisfies its own
--    RLS WITH CHECK regardless of what lesson_id actually references, so
--    nothing previously stopped user B from writing a self_explanation
--    pointing at user A's lesson_id. This trigger verifies the referenced
--    lesson actually belongs to the caller — landed here from the start,
--    not ported as the later fix it originally was.

create table public.self_explanations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  session_id  uuid references public.work_sessions(id) on delete set null,
  prompt      text not null,
  response    text,
  created_at  timestamptz not null default now()
);

create trigger self_explanations_set_user_id
  before insert on public.self_explanations
  for each row execute function public.set_user_id_from_caller();

create function public.check_self_explanation_owner()
returns trigger
language plpgsql
as $$
declare
  lesson_owner uuid;
begin
  select user_id into lesson_owner from public.lessons where id = new.lesson_id;
  if lesson_owner is null then
    raise exception 'check_self_explanation_owner: lesson % not found', new.lesson_id;
  end if;
  if lesson_owner <> auth.uid() then
    raise exception 'check_self_explanation_owner: lesson % does not belong to the caller', new.lesson_id;
  end if;
  return new;
end;
$$;

create trigger self_explanations_check_owner
  before insert or update of lesson_id on public.self_explanations
  for each row execute function public.check_self_explanation_owner();

create index self_explanations_user_id on public.self_explanations (user_id);

alter table public.self_explanations enable row level security;

create policy self_explanations_own_row on public.self_explanations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
