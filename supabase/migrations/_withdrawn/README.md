# Withdrawn migrations — NOT an apply path

Files here are deliberately outside `supabase/migrations/` so that `supabase db push`,
a fresh-database apply, or any glob over the migrations directory cannot pick them up.
Nothing in this folder should ever be applied.

## `096_school_attempts.sql` — withdrawn 2026-09-02 by ruling R1.2

Created the School module's own append-only `attempts` log, replayed by SM-2-lite.

**Superseded, not abandoned.** R1 rules that `reviews` becomes THE append-only log for both
item kinds — cards and questions — with an XOR item reference and one shared
`(confidence, correct) → rating` function, under a single FSRS scheduler. Two review logs
would have made "am I better calibrated on questions than on cards" unanswerable, which is
the cross-domain question the merge exists to answer.

The D32 principle this file was built on survives intact and is now carried by `reviews`:
scheduler state is replayed from the log, never stored, so derived state cannot drift from
its source and a later scheduler change is a different replay function rather than a data
migration. `card_states` is demoted to a rebuildable cache under the same rule.

**Kept rather than deleted** because its header carries reasoning that is still load-bearing
and was expensive to establish: why append-only is enforced by the *absence* of UPDATE and
DELETE policies rather than by a trigger, why `local_date` is a date resolved by the caller
from an IANA zone and never derived from `created_at`, and the `think_so` spelling incident.
Read it as a rationale document, not as SQL to run.

Zero rows existed anywhere when this was withdrawn, so nothing was lost.

## `095_school_questions.sql` and `097_school_composite_fks.sql` — withdrawn 2026-09-02

**Both were untracked on disk and absent from the ledger** — never committed, never applied
through the runner, and living in `supabase/migrations/` where any glob would have picked
them up. That is what made them dangerous rather than merely stale.

**Their live content is already on production, via `111`.** R21 folded CollegeOS's
`questions` half into `111` so `reviews.question_id`'s composite FK had a target. Verified
against production rather than assumed:

```
questions_user_id_id_key            present
questions_class_id_fkey             FOREIGN KEY (user_id, class_id) REFERENCES classes(user_id, id)
```

Re-applying either file would be a no-op at best and an error at worst.

**`097` also references `public.attempts`, which does not exist** — `096` was withdrawn
above, so the table it created was never made. Applying `097` verbatim fails at its
`attempts` half.

**The part worth remembering.** Under bare `psql`, `097`'s failure is not clean: `psql`
auto-commits statement by statement outside an explicit transaction, so its **first four
statements commit** before the `attempts` statement fails. ULM Eng 2 hit exactly this while
rebuilding a container for `111`'s verification, and confirmed it by catalog query rather
than inferring it from the error. The half-applied result *happened* to be the "questions
half" `111` expects — which is luck, not design, and is precisely why
`apply-migration.sh` is `--single-transaction` by default.

`ON_ERROR_STOP` stops the run. It never unwinds what already committed.
