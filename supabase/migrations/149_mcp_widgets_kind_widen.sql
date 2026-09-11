-- 149 — widen `mcp_widgets.kind`'s CHECK to match `WIDGET_KINDS` (R11).
--
-- 141 shipped `mcp_widgets.kind check (kind in ('metric_card', 'list'))` --
-- correct for what had a renderer at the time. Since then, R11's extended
-- declarative vocabulary landed three more kinds end-to-end
-- (progress_against_goal, sparkline, streak): `lib/widgets/validate.ts`'s
-- `WIDGET_KINDS` grew to five, `render.ts`/`actions-core.ts` both have real
-- code for all five, and every one of ~3460 unit tests passed throughout --
-- because every one of them mocks the database. Nothing ever widened this
-- CHECK as the kinds were added.
--
-- Proven on production in a rolled-back transaction (Opus Lead, 2026-09-10):
--   metric_card             accepted
--   list                    accepted
--   progress_against_goal   REJECTED  (mcp_widgets_kind_check)
--   sparkline               REJECTED  (mcp_widgets_kind_check)
--   streak                  REJECTED  (mcp_widgets_kind_check)
--
-- Purely additive -- same "a CHECK, not an enum" reasoning as migration 120's
-- dump_source and 143's prayers_status_check (both widened the identical way:
-- drop the auto-named constraint, re-add it with the larger allowed set). No
-- existing row's `kind` changes meaning; nothing writes the three new kinds
-- until this lands, since the CHECK would reject the write until then.

alter table public.mcp_widgets drop constraint mcp_widgets_kind_check;

alter table public.mcp_widgets add constraint mcp_widgets_kind_check
  check (kind = any (array['metric_card'::text, 'list'::text, 'progress_against_goal'::text, 'sparkline'::text, 'streak'::text]));

-- Verify the widened CHECK actually admits all five kinds, and still refuses
-- an unknown one -- the same "assert the property, not a proxy" discipline
-- this whole migration exists to enforce. `pg_get_constraintdef` is read back
-- from the catalog (what Postgres will actually enforce), never re-derived
-- from this file's own text.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.mcp_widgets'::regclass
    and conname = 'mcp_widgets_kind_check';

  if v_def is null then
    raise exception 'migration 149: mcp_widgets_kind_check is missing after re-adding it';
  end if;

  if v_def not like '%metric_card%' or v_def not like '%list%'
     or v_def not like '%progress_against_goal%' or v_def not like '%sparkline%'
     or v_def not like '%streak%' then
    raise exception 'migration 149: mcp_widgets_kind_check does not admit all five kinds: %', v_def;
  end if;

  raise notice 'migration 149 verified: mcp_widgets_kind_check = %', v_def;
end $$;
