-- "Show Self-Mastery on Home" preference. Written 2026-11-02, NOT yet applied.
--
-- One account-level switch (Settings > Self-Mastery). OFF hides every Self-Mastery piece of Home (the study-session card, "Continue reading",
-- the book-loading banner) and stops Self-Mastery competing for Home's top slot. Default TRUE: nobody's Home changes unless they choose it.
-- Additive, no CHECK needed (boolean). RLS user_settings_own_row already covers the write. No begin;/commit; -- the runner owns the transaction.
--
-- The code reads this column defensively (a missing column = ON), so deploying before applying is safe; apply first anyway.

alter table public.user_settings add column if not exists self_mastery_on_home boolean not null default true;
