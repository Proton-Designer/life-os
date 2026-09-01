-- Self-test payload for check-fk-tenancy.sh. Injects a REAL violation and then
-- runs the REAL detection query, in one session, inside a transaction that is
-- always rolled back.
--
-- Injection and detection must share a session: a rolled-back transaction is
-- invisible to the separate psql connection the checker normally uses, so a
-- two-session self-test would report "not detected" for the wrong reason and
-- look exactly like a broken detector.

begin;

create table public._fk_tenancy_canary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  habit_id uuid references public.custom_habits (id)   -- single-column, user-scoped parent
);

-- The detection query, verbatim from check-fk-tenancy.sh.
select c.conrelid::regclass::text||'.'||a.attname||' -> '||c.confrelid::regclass::text
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
 where c.contype = 'f'
   and c.connamespace = 'public'::regnamespace
   and array_length(c.conkey, 1) = 1
   and c.confrelid::regclass::text <> 'users'
   and exists (select 1 from pg_attribute p
                where p.attrelid = c.confrelid and p.attname = 'user_id' and not p.attisdropped)
 order by 1;

rollback;
