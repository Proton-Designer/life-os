-- ULM: `pending_storage_deletions` — the deferred-cleanup path for storage
-- objects whose rows are gone. If a client's immediate Storage API delete
-- fails (offline, app killed, transient error), the row disappears but the
-- PDF lives forever without this; a worker sweep (out of scope here) makes
-- "delete" actually mean the file is gone even when the immediate call
-- fails.
--
-- Sourced from `20260815052000_l1a_pending_storage_deletions.sql` and
-- checked against `20260815051000_l1a_fix_storage_delete.sql` per the Opus
-- Lead's instruction. Scoped to the table itself only — `delete_book`,
-- `confirm_storage_deleted`, and `purge_user_data` are bundled with this
-- table in ULM's original history, but all three are explicitly out of
-- scope: `purge_user_data` was already ruled a later-batch, sanctioned-door
-- RPC (see 072_ulm_reviews.sql's comment), and `delete_book` depends on
-- `books.deleted_at`, a column that does not exist anywhere in this batch —
-- porting it now would either invent that column unasked or ship a
-- function referencing a column that isn't there. This table currently has
-- no writer; it becomes reachable once whichever later batch lands the
-- account/book-deletion RPCs.
--
-- RLS is enabled with NO policies at all — not an oversight, ULM's original
-- design: this table is only ever touched by SECURITY DEFINER functions and
-- the worker's service_role connection (which bypasses RLS entirely), never
-- by a direct authenticated-user query. Made that explicit as a database
-- fact rather than only a comment: an explicit `using (false)` policy for
-- `authenticated` is behaviourally identical to having zero policies (deny
-- always) but is machine-checkable — `check-rls.sh` treats RLS-on-zero-
-- policy as a finding worth a human look, and this makes clear it's
-- intentional rather than forgotten.

create table public.pending_storage_deletions (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  last_error    text,
  created_at    timestamptz not null default now()
);

create index pending_storage_deletions_sweep
  on public.pending_storage_deletions (created_at)
  where attempts < max_attempts;

alter table public.pending_storage_deletions enable row level security;

create policy pending_storage_deletions_deny_authenticated on public.pending_storage_deletions
  for all to authenticated
  using (false)
  with check (false);
