-- Splits the 'wasted' accounting sentinel out of checkin_allocations.domain
-- (Boss ruling, domains-as-data design doc, 2026-09-02) — the first of the
-- ordered (a)->(b)->(c) sequence, and first specifically because it is
-- unfixable in place once real ordering matters: the CHECK constraint
-- currently shares one namespace between the 5 real domain values and the
-- 'wasted' accounting sentinel --
--   checkin_allocations_domain_check: domain = ANY(['deen','business',
--   'school','fitness','co_op','wasted'])
-- -- so the moment a user can create a domain literally named "wasted"
-- (ruling b/c widen the set to user-created Work subdomains), that row
-- silently merges into unaccounted time. Splitting the discriminant first
-- means no later migration ever has to detect and repair that collision
-- after the fact.
--
-- Shape: reuses the nullable-XOR-discriminator idiom this project already
-- adopted this week for reviews.card_id/question_id (Boss ruling R1) rather
-- than inventing a new pattern. `domain` becomes nullable and stays
-- validated against the real 5 values (unchanged, minus 'wasted'); a new
-- `is_wasted boolean` carries the accounting meaning on its own column.
-- `NULL = ANY(...)` evaluates to NULL, which a CHECK constraint treats as
-- passing -- verified directly on scratch before relying on it here (see
-- the design doc) -- so the unchanged domain check already permits
-- `domain IS NULL` for free; no rewrite of that check's array shape beyond
-- dropping the 'wasted' literal.
--
-- checkin_allocations_checkin_id_domain_key (unique on (checkin_id,domain))
-- exempts NULL rows by ordinary SQL NULL-distinctness -- multiple is_wasted
-- rows per checkin would now be silently legal under that constraint alone,
-- which breaks the original "at most one wasted entry per checkin"
-- guarantee the old domain='wasted' row implicitly had. A separate partial
-- unique index restores exactly that guarantee without touching the
-- per-domain uniqueness.
--
-- Apply to scratch only (Opus Lead owns production). Run via
-- ./scripts/apply-migration.sh so it lands in the ledger (102).

begin;

alter table public.checkin_allocations
  alter column domain drop not null;

alter table public.checkin_allocations
  add column is_wasted boolean not null default false;

-- Backfill first, then tighten constraints -- if any 'wasted' rows exist
-- (none do on scratch as of this writing, verified: `select domain,
-- count(*) from checkin_allocations group by domain` returned 0 rows), this
-- keeps them meaning the same thing under the new shape instead of being
-- silently reclassified as a real (and now-invalid) domain value.
update public.checkin_allocations
  set is_wasted = true, domain = null
  where domain = 'wasted';

alter table public.checkin_allocations
  drop constraint checkin_allocations_domain_check;

alter table public.checkin_allocations
  add constraint checkin_allocations_domain_check
  check (domain = any (array['deen', 'business', 'school', 'fitness', 'co_op']));

alter table public.checkin_allocations
  add constraint checkin_allocations_domain_wasted_xor
  check ((is_wasted and domain is null) or (not is_wasted and domain is not null));

-- Restores "at most one wasted entry per checkin" now that domain=NULL rows
-- are exempt from the pre-existing (checkin_id, domain) unique constraint.
create unique index checkin_allocations_one_wasted_per_checkin
  on public.checkin_allocations (checkin_id)
  where is_wasted;

-- save_allocation_checkin (020, made idempotent in 022) previously received
-- 'wasted' as just another key in p_allocations and inserted it through the
-- same loop as every real domain -- the actual write-path instance of the
-- sentinel-sharing-a-namespace bug, not just a read-side concern. Dropped
-- and recreated with an explicit p_wasted_minutes param so the accounting
-- value never travels through the domain-keyed jsonb map at all. Client
-- caller (app/(app)/checkin/allocation-actions.ts) updated in the same
-- commit as this migration.
drop function if exists public.save_allocation_checkin(timestamptz, timestamptz, jsonb);

create function public.save_allocation_checkin(
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_allocations jsonb,
  p_wasted_minutes int
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_checkin_id uuid;
  v_domain text;
  v_minutes int;
begin
  insert into public.checkins (user_id, checkin_time, kind, window_start, window_end, answered)
  values (auth.uid(), p_window_end, 'allocation', p_window_start, p_window_end, true)
  returning id into v_checkin_id;

  for v_domain, v_minutes in
    select key, value::int from jsonb_each_text(p_allocations)
  loop
    insert into public.checkin_allocations (checkin_id, user_id, domain, minutes)
    values (v_checkin_id, auth.uid(), v_domain, v_minutes);
  end loop;

  insert into public.checkin_allocations (checkin_id, user_id, domain, minutes, is_wasted)
  values (v_checkin_id, auth.uid(), null, p_wasted_minutes, true);

  return v_checkin_id;
exception
  when unique_violation then
    select id into v_checkin_id
      from public.checkins
      where user_id = auth.uid() and window_start = p_window_start and kind = 'allocation';
    return v_checkin_id;
end;
$$;

grant execute on function public.save_allocation_checkin(timestamptz, timestamptz, jsonb, int) to authenticated;

commit;
