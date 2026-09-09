# `deen.prayer.unlog` — why it isn't wired, and what wiring it would cost

**Status: open, handed to the lead. Not resolved by this file.**

## The guardrail this runs into

L6's brief: "No tool ever hard-deletes a row. Insert, update, or status change
only." `unmarkPrayer` (`app/(app)/deen/actions.ts`) is a real `DELETE` —
correcting a misclick by removing the `prayers` row entirely. The MCP write
path may not do that. This file is the "decide deliberately... if it genuinely
requires a schema change, say so" the brief asked for.

## Why `status = 'pending'` is not a safe substitute

The `prayers.status` column's `CHECK` constraint allows `'pending'` as a
value, so the obvious-looking fix — `write` sets `status: 'pending'` instead
of deleting — looks free. It is not. `lib/deen/prayer-status.ts`'s
`effectivePrayerStatus`:

```ts
export function effectivePrayerStatus(
  stored: StoredPrayerStatus | null,
  window: PrayerWindow | null,
  now: Date
): EffectivePrayerStatus {
  if (stored) return stored;              // <-- the line that breaks this
  if (window === null) return "pending";
  if (now.getTime() >= window.end.getTime()) return "missed";
  if (now.getTime() >= window.start.getTime()) return "pending";
  return "upcoming";
}
```

`stored` is typed `StoredPrayerStatus | null` where
`StoredPrayerStatus = "on_time" | "qada" | "missed"` — the app's own
TypeScript type **does not include `"pending"` as something it ever
writes**, even though the database column would accept it. A row with
`status: "pending"` is a non-empty string, so `if (stored) return stored`
returns `"pending"` **literally and permanently** — it does not fall through
to the window-based derivation that turns an *absent* row into
`upcoming`/`pending`/`missed` as the clock moves. Deleting the row is what
makes that derivation run again. Setting `status: "pending"` freezes the
prayer at "pending" forever, which is a materially different, and wrong,
outcome — not a cosmetic difference from deletion.

This is read by every consumer `unmarkPrayer`'s own comment names: streaks,
qada backlog, consistency grid, Home's priority feed. A wrong stand-in here
doesn't just affect MCP's own response — a write-tool "unlog" implemented
this way would corrupt the SAME data every other surface in the app reads.

## The two honest options

1. **Leave `unlog` unwired until a deliberate schema decision is made.**
   What this layer actually did. `deen.prayer` supports `action: "log"`
   only; `write(domain:"deen", entity:"prayer", action:"unlog", ...)`
   returns a clear "unknown action" error naming `log` as the only
   available one — an honest gap, not a silent wrong answer.

2. **Add a real non-destructive "cleared" state**, e.g. a new allowed
   `status` value (`'unlogged'`, or similar) that `effectivePrayerStatus`
   is taught to treat the SAME as an absent row:

   ```ts
   if (stored && stored !== "unlogged") return stored;
   ```

   This is a small, scoped migration (one `CHECK` constraint value, a
   two-line change to one function) rather than a sweeping one, and it is
   arguably a **better** design than the current DELETE: the row's history
   (`logged_at`, the fact an unlog happened) survives instead of being
   erased, which fits this app's own general preference for soft-state over
   deletion elsewhere (`deen_habits.archived`, never a hard delete). It
   does, however, touch a function four other features read from, so it
   needs the same sign-off any other cross-cutting schema change gets —
   not something to land as a side effect of an MCP tool.

## Recommendation

Option 2, but not built here. Flagging it as a candidate for a future
migration, owner's/lead's call, same as R6/widget_manage's own
"flagged, not resolved" items in `TOOL-ARCHITECTURE.md` §6.
