-- 169 — link distraction_events to the work session it happened during
-- (#52). NUMBER RESERVED FOR THIS TRACK BY THE LEAD (see
-- supabase/migrations/ALLOCATIONS.md's "169-170" row, recorded before this
-- file existed) — do not apply until the lead confirms.
--
-- `distraction_events` today: id, user_id, trigger_id, date, reflection_tier,
-- reflection_entry_id, created_at (migration 041) — no session_id at all, so
-- "how many distractions this session" has never been answerable from this
-- table; a caller could only ever ask "how many today."
--
-- `session_id` REFERENCES `public.work_sessions`, THE SAME PARENT
-- `trigger_action_plans`/`checkins`/ULM's review tables already point at
-- (migrations 072/073/101/146) — not a new "sessions" concept. Lock-In
-- (Deep Work) and Deep Study sessions both live there; a distraction logged
-- during either kind links to the same table.
--
-- NULLABLE ON PURPOSE. Most distractions still happen with no active
-- session (the capture dialog and the MCP write path both work with no
-- session running at all — see lib/distractions/actions-core.ts), and
-- there is nothing to link to then. `session_id null` means exactly that,
-- not "unknown."
--
-- COMPOSITE TENANCY FK: `(user_id, session_id) -> work_sessions (user_id, id)`,
-- reusing `work_sessions_user_id_id_key` (already created by migration 089 /
-- reconfirmed by 101) as the anchor — no new unique index needed on the
-- parent side. A single-column FK to `work_sessions(id)` alone would let a
-- distraction event's `session_id` point at another user's session (the FK
-- only requires the row to exist, not that it belongs to the same user);
-- the composite form makes that unrepresentable, same discipline as every
-- other cross-tenant hardening pass in this schema (058/086/087/100/140).
--
-- ON DELETE SET NULL, COLUMN-SCOPED -- `ON DELETE SET NULL (session_id)`,
-- NOT the unqualified form. THE TRAP (migration 140's own header, and
-- lessons.md's "Composite FK ON DELETE SET NULL trap"): an unqualified
-- `ON DELETE SET NULL` on a composite FK nulls *every* column of the
-- referencing key, including `user_id` -- which is NOT NULL on
-- `distraction_events` -- so deleting a work session with any linked
-- distraction event would not clear the reference, it would raise, and the
-- delete would become unreachable. The column-scoped form (Postgres 15+;
-- this server is 17.6, per 140's own note) clears only `session_id` and
-- leaves `user_id` intact. Never relax the NOT NULL to work around this --
-- a row with a null user_id belongs to nobody and is invisible to RLS.
--
-- No RLS/policy change: distraction_events' own-row policy (migration 041)
-- already covers every column, this one included.
--
-- No begin;/commit; -- the runner owns the transaction (files >110 that
-- carry their own fail the apply, per migration 111's history).

alter table public.distraction_events
  add column session_id uuid null;

comment on column public.distraction_events.session_id is
  'The work_sessions row active when this distraction was captured (#52) -- null when none was running. References work_sessions(user_id, id), the same composite-FK parent trigger_action_plans/checkins/ULM''s review tables already use.';

create index distraction_events_session_id_idx
  on public.distraction_events (session_id)
  where session_id is not null;

alter table public.distraction_events
  add constraint distraction_events_session_same_user
  foreign key (user_id, session_id)
  references public.work_sessions (user_id, id)
  on delete set null (session_id);

do $$
declare
  v_col int;
  v_fk int;
  v_fk_delete_rule text;
  v_idx int;
begin
  select count(*) into v_col from information_schema.columns
   where table_schema = 'public' and table_name = 'distraction_events' and column_name = 'session_id';
  if v_col <> 1 then
    raise exception '169: distraction_events.session_id column is absent';
  end if;

  select count(*) into v_fk from pg_constraint
   where conname = 'distraction_events_session_same_user' and contype = 'f';
  if v_fk <> 1 then
    raise exception '169: distraction_events_session_same_user composite FK is absent';
  end if;

  -- Confirms the FK is scoped to session_id alone, not the whole key --
  -- the exact trap 140 fixed elsewhere. `pg_constraint.confdelsetcols`
  -- (int2[]) is Postgres's own record of which referencing columns a
  -- column-scoped ON DELETE SET NULL/DEFAULT clears; null/empty means the
  -- unqualified (whole-key) form that 140's header identifies as the bug.
  select case when confdelsetcols is not null and array_length(confdelsetcols, 1) = 1 then 'scoped' else 'unscoped' end
    into v_fk_delete_rule
    from pg_constraint where conname = 'distraction_events_session_same_user';
  if v_fk_delete_rule is distinct from 'scoped' then
    raise exception '169: distraction_events_session_same_user is not column-scoped to session_id -- deleting a work session with a linked distraction event would be unreachable (migration 140''s trap)';
  end if;

  select count(*) into v_idx from pg_indexes
   where schemaname = 'public' and tablename = 'distraction_events' and indexname = 'distraction_events_session_id_idx';
  if v_idx <> 1 then
    raise exception '169: distraction_events_session_id_idx is absent';
  end if;

  raise notice '169 verified: distraction_events.session_id present, composite FK to work_sessions(user_id,id) column-scoped ON DELETE SET NULL, index in place';
end $$;
