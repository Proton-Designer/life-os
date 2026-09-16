-- 219: fsrs_user_parameters (P3-20, per-user FSRS tuning). New table.
--
-- Reviews.ts's own header (072) anticipated this exact feature ("enable
-- per-user FSRS parameter optimization later") -- this is that table.
-- One row per user, `user_id` IS the primary key (same self-owned-settings
-- shape as `user_settings`, migration 066), created/replaced wholesale by
-- a re-run of the tuning computation, never partially patched.
--
-- SELECT-only for `authenticated`, DELIBERATELY no INSERT/UPDATE/DELETE
-- policy: `weights` is a derived, computed artifact (the output of an
-- optimizer run over the user's own review history), not free-form user
-- input -- a client should never be able to POST arbitrary scheduling
-- weights for itself via PostgREST directly, bypassing the real
-- computation. The tuning Server Action (lib/self-mastery/fsrs-tuning.ts)
-- writes via a service-role client, AFTER `requireUser()` has already
-- resolved the caller's identity server-side -- same precedent as
-- app/(app)/settings/account-actions.ts's own use of
-- `createServiceRoleClient()` inside a cookie-authed Server Action.
--
-- No begin;/commit; -- apply-migration.sh owns the transaction.

create table public.fsrs_user_parameters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weights real[] not null,
  trained_at timestamptz not null,
  review_count_at_train int not null,
  loss real null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fsrs_user_parameters enable row level security;

create policy fsrs_user_parameters_select_own on public.fsrs_user_parameters
  for select to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists fsrs_user_parameters_touch_updated_at on public.fsrs_user_parameters;
create trigger fsrs_user_parameters_touch_updated_at
  before update on public.fsrs_user_parameters for each row execute function public.touch_updated_at();

comment on column public.fsrs_user_parameters.weights is
  'The tuned 21-parameter ts-fsrs `w` vector for this user, produced by '
  'lib/self-mastery/fsrs-tuning.ts''s optimizer over their own review '
  'history. Never client-writable -- see this migration''s own header.';

comment on column public.fsrs_user_parameters.review_count_at_train is
  'How many reviews existed when this row was (re)trained -- the gate is '
  '>=1000; this is also shown in the UI as "trained on N reviews" context, '
  'not re-derived from a live count on every read.';

comment on column public.fsrs_user_parameters.loss is
  'Mean per-review binary cross-entropy loss the optimizer converged to, '
  'for diagnostic display only (e.g. "lower is better" trend across '
  'retrainings) -- never read by the scheduler itself.';
