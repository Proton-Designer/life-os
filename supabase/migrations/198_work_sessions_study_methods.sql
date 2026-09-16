-- P3-03: name, persist, and surface the study techniques a "learn"-kind
-- work_sessions row actually used. Four of the six named modes
-- (Retrieval/Interleave/Draft/Recite) already existed as separately-built,
-- unnamed-to-the-user mechanisms; this column is the first place any of
-- them is recorded per-session. `lib/self-mastery/study-methods.ts` is the
-- single source of truth for the enum below and for what each id means —
-- update both in the same change if the set ever grows.
--
-- Only 'retrieval'/'interleave'/'draft' are ever written today:
-- 'recite' (Teach-Back, P2-18) takes no session_id in its own API and is
-- deliberately sessionless; 'compose' has no implementation anywhere yet;
-- 'cards' is reserved for P3-05 (flagged off, not built). All three remain
-- valid values so a future task can start writing them without a second
-- migration, but nothing in this app writes them yet.
--
-- SAME PATTERN AS 134_profiles_theme_and_features.sql's hidden_features:
-- additive, ADD COLUMN with a default that reproduces today's behavior
-- exactly (every existing session row gets '{}', i.e. "nothing recorded",
-- which is honestly true — none of this was tracked before tonight).
alter table public.work_sessions
  add column if not exists study_methods text[] not null default '{}'::text[]
    check (study_methods <@ array['retrieval', 'interleave', 'draft', 'recite', 'compose', 'cards']::text[]);

comment on column public.work_sessions.study_methods is
  'P3-03: which named study techniques (lib/self-mastery/study-methods.ts is the source of truth) '
  'this session actually used. Only meaningful for kind=''learn'' sessions -- every other kind '
  'leaves it at the default ''{}''. Written incrementally during the session (buildTodaysSession '
  'records retrieval/interleave once the plan is known; submitSelfExplanation appends draft on a '
  'real, non-skipped submission), never fabricated for a technique that did not actually happen.';
