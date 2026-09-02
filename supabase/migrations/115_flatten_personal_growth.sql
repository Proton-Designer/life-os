-- R27 / A3 Part 1+4b: flatten Personal Growth. "Personal Growth is a shell
-- artifact, not a user concept" -- Faith/Body/Learning (formerly the
-- faith/fitness/self_mastery user_subdomains children of a personal_growth
-- user_domains row) become peer top-level user_domains rows, so weight is
-- carried at the granularity the user actually picks (six areas), not
-- three groups. Work/School/Business are untouched by this file (Business
-- and Work-absorbs-co_op are pure additions with zero existing rows to
-- migrate -- see the design page in the peer log, not repeated here).
--
-- THE BOSS'S RULING ON THE EDGE CASE (binding, supersedes this file's
-- earlier draft reasoning): a personal_growth row is never deleted, only
-- ARCHIVED -- with or without live children. Two cases:
--   1. Zero NON-ARCHIVED children: flattens into NOTHING (no new rows).
--      The group row is archived and its weight tier is recorded in
--      migration_115_orphaned_group_weight_log, so a user's protect-two
--      answer for a since-emptied Personal Growth pick is not silently
--      discarded -- it has nowhere live to attach, but it is not lost.
--   2. One or more non-archived children: the group's weight and position
--      distribute to EACH non-archived child (a new row per child,
--      children keeping their relative sub-order), and the group row is
--      then ALSO archived -- not deleted.
-- An individually-archived subdomain child (whether the group is
-- otherwise live or fully childless-of-active) is NOT promoted to a new
-- row. Its history is not lost either: user_subdomains is untouched by
-- this migration entirely (no delete, no cascade) -- it stays attached to
-- the now-archived personal_growth row exactly as it was, fully
-- inspectable. New top-level rows are a COPY of the currently-active
-- facts into the new model, not a move; the old rows remain the complete
-- historical record.
--
-- Because the group row survives (archived), 'personal_growth' must stay
-- a legal `key` value -- the widened CHECK below ADDS the four new keys
-- rather than replacing the set. Application code must never write
-- 'personal_growth' to a NEW or re-activated row after this migration;
-- the CHECK only guarantees the column accepts it, the same way an
-- archived-only convention is enforced by the app elsewhere in this
-- schema, not by SQL.
--
-- The verification gate (run manually against the counts this file prints
-- via RAISE NOTICE, before trusting the migration): children-out (new
-- rows inserted) must equal the count of non-archived user_subdomains
-- children across all personal_growth rows; archived personal_growth rows
-- after must equal ALL personal_growth rows that existed before (every one
-- of them ends up archived, none remain active, none are deleted). A
-- `distinct on`-shaped backfill that silently skips a childless group
-- would show up here as children-out matching but SOME group row still
-- archived_at IS NULL, or as a log-table row count mismatch -- both are
-- checked explicitly rather than assumed.


-- Audit-only, not application-facing: RLS enabled with zero policies, so
-- no role but the table owner/service role can read it. Its only purpose
-- is answering "what was this user's Personal Growth weight, if Personal
-- Growth ended up with nothing live under it" after the fact.
create table public.migration_115_orphaned_group_weight_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  group_id uuid not null,
  weight text not null,
  group_position smallint not null,
  group_archived_at timestamptz null,
  logged_at timestamptz not null default now()
);
alter table public.migration_115_orphaned_group_weight_log enable row level security;

alter table public.user_domains
  drop constraint user_domains_key_check;
alter table public.user_domains
  add constraint user_domains_key_check
  check (key in ('personal_growth', 'faith', 'business', 'body', 'learning', 'work', 'school'));

-- A migration-scoped helper column, dropped before commit -- NOT an
-- overload of `position` itself. An earlier draft of this file tried to
-- encode both "the group's old slot" and "the child's own sub-position"
-- into one `position * 1000 + sub_position` value; that collided with an
-- untouched row's real (small) position whenever it happened to fall
-- inside the expanded range, sorting e.g. `work` BETWEEN two of the
-- group's children instead of after all of them. A real column, compared
-- separately from `position` in the renumber ORDER BY below, has no such
-- collision: `faith`/`body`/`learning` are guaranteed-new keys (they did
-- not exist before this migration) so they are exactly the rows this
-- column is non-null for; `work`/`school` are guaranteed pre-existing and
-- untouched, so this column is null for them and sorts first via coalesce.
alter table public.user_domains add column _migration_115_sub_position smallint;

-- Case 2: promote each non-archived child of a personal_growth row to a
-- new top-level row. `position` is provisional here (copies the group's
-- old slot; ties among the group's own siblings are broken by
-- _migration_115_sub_position in the renumber step below, not by this
-- value) -- renumbered to a contiguous per-user sequence before the helper
-- column is dropped.
insert into public.user_domains (user_id, key, position, weight, archived_at, created_at, updated_at, _migration_115_sub_position)
select
  s.user_id,
  case s.key
    when 'faith' then 'faith'
    when 'self_mastery' then 'learning'
    when 'fitness' then 'body'
  end,
  d.position,
  d.weight,
  null, -- s.archived_at is null by the WHERE clause below -- these are the live children
  s.created_at,
  now(),
  s.position
from public.user_subdomains s
join public.user_domains d on d.id = s.domain_id
where d.key = 'personal_growth'
  and s.archived_at is null
  and s.key in ('faith', 'self_mastery', 'fitness');

-- Case 1: log the weight of a group whose children are ALL archived (or
-- who has no children at all -- covered by the same NOT EXISTS shape),
-- since it produces zero rows above and would otherwise vanish with its
-- protect-two answer unrecorded.
insert into public.migration_115_orphaned_group_weight_log (user_id, group_id, weight, group_position, group_archived_at)
select d.user_id, d.id, d.weight, d.position, d.archived_at
from public.user_domains d
where d.key = 'personal_growth'
  and not exists (
    select 1 from public.user_subdomains s
    where s.domain_id = d.id and s.archived_at is null and s.key in ('faith', 'self_mastery', 'fitness')
  );

-- Every personal_growth row is archived, none deleted -- coalesce so an
-- already-archived group keeps its real original archived_at rather than
-- being re-dated to now().
update public.user_domains
set archived_at = coalesce(archived_at, now()), updated_at = now()
where key = 'personal_growth';

-- Renumber ACTIVE rows per user into a contiguous 0..N-1 sequence, sorted
-- by the group's old slot first and each row's own sub-position second
-- (null -- i.e. every untouched work/school row -- sorts before any real
-- sub-position via NULLS FIRST, which only matters as a tiebreak when two
-- rows land on the exact same `position`; ties on BOTH columns fall back
-- to `key` only as a last, deterministic resort). The split can leave
-- duplicate/gapped positions (multiple new siblings sharing the old
-- group's slot); archived rows (the retired groups, and any row a user
-- had already archived before this migration) are left with whatever
-- position they already had -- ordering among archived rows is not read
-- by anything live.
with ranked as (
  select id, row_number() over (
    partition by user_id
    order by position, _migration_115_sub_position nulls first, key
  ) - 1 as new_position
  from public.user_domains
  where archived_at is null
)
update public.user_domains d
set position = r.new_position
from ranked r
where d.id = r.id;

alter table public.user_domains drop column _migration_115_sub_position;

do $$
declare
  v_children_out int;
  v_children_expected int;
  v_groups_before int;
  v_groups_still_active int;
  v_log_rows int;
  v_log_expected int;
begin
  select count(*) into v_children_out from public.user_domains where key in ('faith', 'body', 'learning');
  select count(*) into v_children_expected
    from public.user_subdomains s join public.user_domains d on d.id = s.domain_id
    where d.key = 'personal_growth' and s.archived_at is null and s.key in ('faith', 'self_mastery', 'fitness');
  if v_children_out <> v_children_expected then
    raise exception 'migration 115: children-out (%) != non-archived children-in (%)', v_children_out, v_children_expected;
  end if;

  select count(*) into v_groups_still_active from public.user_domains where key = 'personal_growth' and archived_at is null;
  if v_groups_still_active <> 0 then
    raise exception 'migration 115: % personal_growth row(s) still active (archived_at is null) after the migration -- every one must be archived', v_groups_still_active;
  end if;

  select count(*) into v_log_rows from public.migration_115_orphaned_group_weight_log;
  select count(*) into v_log_expected
    from public.user_domains d
    where d.key = 'personal_growth'
      and not exists (
        select 1 from public.user_subdomains s
        where s.domain_id = d.id and s.archived_at is null and s.key in ('faith', 'self_mastery', 'fitness')
      );
  if v_log_rows <> v_log_expected then
    raise exception 'migration 115: orphaned-weight log has % rows, expected % (childless-of-active personal_growth rows)', v_log_rows, v_log_expected;
  end if;

  raise notice 'migration 115 verified: % new child rows, % orphaned-group weights logged', v_children_out, v_log_rows;
end $$;

