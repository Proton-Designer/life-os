-- 267: the 2-hour check-in is opt-in, and an untracked-time answer can be "rest" / "errands".
--
-- 1) profiles.allocation_checkins_enabled: the automatic 2-hour check-in (queue, toast, notification, topbar icon) is OFF
--    by default. Accounts that actually used it (answered an allocation check-in in the last 14 days) keep it ON so nothing
--    changes under them; everyone else, including every new account, starts OFF and can turn it on in Settings.
-- 2) checkins.gap_label: the evening close asks about stretches of the day no session / prayer / workout / check-in covers
--    ("Your untracked time"). An answer is stored as an ordinary allocation check-in whose window is that stretch, so every
--    existing reader keeps working. 'rest' and 'errands' are neutral (no focus-area minutes, not wasted), so they hold no
--    allocation rows; this column is what says what the stretch was. NULL = a normal check-in.
--
-- Two additive columns. No begin;/commit; -- the runner owns the transaction.

alter table public.profiles
  add column allocation_checkins_enabled boolean not null default false;

comment on column public.profiles.allocation_checkins_enabled is
  'The automatic 2-hour allocation check-in (queue, toast, notification, topbar icon). Default OFF; opt in from Settings.';

update public.profiles p
   set allocation_checkins_enabled = true
 where exists (
   select 1 from public.checkins c
    where c.user_id = p.user_id
      and c.kind = 'allocation'
      and c.created_at >= now() - interval '14 days'
 );

alter table public.checkins
  add column gap_label text;

alter table public.checkins
  add constraint checkins_gap_label_check check (gap_label is null or gap_label in ('rest', 'errands'));

comment on column public.checkins.gap_label is
  'Set on an evening-close untracked-time answer that is neutral: ''rest'' (rest or meals) or ''errands''. NULL = a normal check-in.';

do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'profiles' and column_name = 'allocation_checkins_enabled' and is_nullable = 'NO')
       or (table_name = 'checkins' and column_name = 'gap_label' and is_nullable = 'YES'));
  if v_n <> 2 then
    raise exception 'migration 267: expected profiles.allocation_checkins_enabled (not null) and checkins.gap_label (nullable), found % of 2', v_n;
  end if;
  raise notice 'migration 267 verified';
end $$;
