-- 205: canvas_course_mappings.dismissed_at (CANVAS-LITE-03, Team Sonnet
-- ENG 1, allocated by Opus Lead). Builds on migration 210
-- (canvas_course_mappings itself).
--
-- The user's own instruction, on reading CANVAS-GAP-05's finding: "if the
-- user's Canvas API is connected, then their classes should automatically
-- be added in. And obviously with the option to remove, change, edit, or
-- add another class." Auto-creating a class per Canvas course (this
-- task's own scope) makes "remove" load-bearing in a way it wasn't
-- before: a class that only ever existed because a sync created it must
-- NOT silently reappear the next time connect/sync runs.
--
-- dismissed_at is set the moment the user deletes or unlinks a class that
-- was linked to a Canvas course -- a future auto-import pass skips any
-- mapping row where this is set. It does NOT block the user from manually
-- re-mapping that Canvas course to a (possibly different) local class
-- later via the existing Settings mapping UI -- only *automatic*
-- re-creation on the next sync is blocked, exactly the same
-- "structurally never comes back on its own, but not permanently
-- forbidden" posture staging_batches' own tombstone columns (migrations
-- 189/194) already established for staged-and-rejected Canvas items.
--
-- Nullable, defaults to null (the overwhelming common case: never
-- dismissed). No index -- this column is only ever read as a per-row
-- IS NULL check against a row already being fetched by
-- (user_id, canvas_course_id), which migration 210's own unique index
-- already covers.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

alter table public.canvas_course_mappings
  add column dismissed_at timestamptz null;

comment on column public.canvas_course_mappings.dismissed_at is
  'CANVAS-LITE-03: set when the user deletes or unlinks a class that was '
  'linked to this Canvas course. A future auto-import pass (connect or '
  'sync) skips creating/relinking a class for this mapping while this is '
  'set -- removal sticks. Does not block manually re-mapping this course '
  'to a class later via Settings; only automatic re-creation is blocked.';
