-- P2-01, overnight run 2026-09-15, Sonnet ENG 1 (Team A).
--
-- Per-user monthly AI spend ceiling: a personal budget control, distinct
-- from lib/ai/spend-cap.ts's global lifetime cap on the ONE shared,
-- operator-funded DeepSeek balance. That file's own header explicitly
-- scopes itself away from this concern ("A user's OWN key is never gated
-- here at all... capping it would be paternalistic and would protect
-- nothing of ours") -- this column is the opt-in opposite: a user protecting
-- THEMSELVES from an unexpectedly large bill, on ANY key source, reset
-- monthly in their own timezone (see lib/ai/monthly-spend-cap.ts).
--
-- NULLABLE, DEFAULT-BY-ABSENCE: NULL means "use the system default"
-- (DEFAULT_MONTHLY_SPEND_CAP_USD, $10.00, in lib/ai/monthly-spend-cap.ts),
-- not "no cap" -- there is no unlimited escape hatch here, matching this
-- app's founding rule that every opt-in AI setting degrades to a safe
-- default rather than an unbounded one. A user who has never opened the AI
-- settings page still gets a real ceiling.
--
-- CHECK > 0 when set: a zero or negative cap would either always-block
-- (0, confusing -- use the UI to disable AI features another way, this
-- column isn't a kill switch) or be nonsensical (negative). Enforced here,
-- not just in the server action, so no future write path can slip past it.
alter table public.profiles
  add column ai_monthly_spend_cap_usd numeric(10, 2) null
    constraint profiles_ai_monthly_spend_cap_usd_positive check (ai_monthly_spend_cap_usd is null or ai_monthly_spend_cap_usd > 0);
