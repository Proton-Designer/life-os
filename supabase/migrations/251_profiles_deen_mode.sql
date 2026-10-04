-- 251: Deen Mode -- one durable per-account switch for everything religious.
-- (Sonnet ENG 1, DEEN-02; number allocated by the Opus lead for the 2026-10-04 run.)
--
-- Single boolean on profiles, same shape as the other user-editable display
-- prefs there (theme_preset, hidden_features, enabled_features): the authed
-- shell already loads the full profiles row via getProfile(), so every
-- surface can read it with no extra query. Owner update goes through the
-- existing profiles RLS policy; no column-level grants exist on profiles.
--
-- DEFAULT FALSE: every new account has all religious UI stripped until the
-- user turns it on in Settings -> Features. Turning it off is a render/
-- behaviour gate only -- no deen table or user_domains row is ever touched.
--
-- NO BACKFILL HERE: the lead flips specific real accounts separately on prod.
alter table public.profiles
  add column if not exists deen_mode boolean not null default false;

comment on column public.profiles.deen_mode is
  'Deen Mode: when true the Faith section (prayer, Qur''an, sunnah, habits), its Home modules and its Settings options are shown. Default false = everything religious hidden. Gate only: turning it off never deletes or mutates deen data (prayers, quran_sessions, sunnah_logs, deen_habits, user_domains faith rows). Read via lib/deen/deen-mode.ts isDeenModeOn(); fail closed on null/missing.';
