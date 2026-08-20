-- Persisted read/unread state for the topbar Notifications bell
-- (components/shell/notifications-bell.tsx, lib/notifications/get-notifications.ts).
-- Ayman's 2026-08-20 request: clicking a notification marks it read
-- (darkened, excluded from the badge count) and that must survive a
-- reload — not just component state.
--
-- Scoped per calendar day, not permanent: several notification ids recur
-- daily and are not unique per occurrence ("prayer-dhuhr", the literal
-- "kill-list"), so a permanent per-id read flag would leave tomorrow's
-- occurrence silently pre-read. `date` here is always the user's own
-- local calendar date (localDateString(now, profile.timezone) — see
-- get-notifications.ts / actions.ts), never a UTC date, matching the
-- other user-local-date bugs found and fixed elsewhere in this build.
--
-- Unique on (user_id, notification_key, date), and the app writes via
-- upsert(..., { ignoreDuplicates: true }) — an ON CONFLICT DO NOTHING at
-- the database, same discipline as confirm_workout_session (029): a
-- double-click or two racing tabs marking the same notification read
-- must not error and must not double-write.

create table public.notification_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notification_key text not null,
  date date not null,
  read_at timestamptz not null default now(),
  unique (user_id, notification_key, date)
);

create index notification_reads_user_date_idx on public.notification_reads (user_id, date);

alter table public.notification_reads enable row level security;

create policy "notification_reads_own_row"
  on public.notification_reads for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
