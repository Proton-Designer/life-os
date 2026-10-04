-- READ-ONLY audit: every foreign key whose referencing columns are not the leading prefix of any valid
-- index on the child table, with the child's estimated row count (pg_class.reltuples; -1 = never analysed)
-- and its size. Run with: psql "$URL" -X -f scripts/audit-unindexed-fks.sql
-- Selects only from the catalogs; changes nothing.
select
  c.conrelid::regclass::text                                            as child_table,
  (select string_agg(a.attname, ', ' order by k.ord)
     from unnest(c.conkey) with ordinality as k(attnum, ord)
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as fk_columns,
  c.confrelid::regclass::text                                           as parent_table,
  c.confdeltype                                                         as on_delete,   -- a = no action, c = cascade, n = set null
  r.reltuples::bigint                                                   as est_rows,
  pg_size_pretty(pg_total_relation_size(c.conrelid))                    as total_size
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f'
  and n.nspname = 'public'
  and not exists (
    select 1 from pg_index i
     where i.indrelid = c.conrelid
       and i.indisvalid
       and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey::int2[]
  )
order by r.reltuples desc, child_table, fk_columns;
