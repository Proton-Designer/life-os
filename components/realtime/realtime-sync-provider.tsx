"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Cross-device live sync (2026-08-25/26 batch 2, item 2 — Ruling R1).
 * A mutation's revalidatePath() only busts the SERVER's cache; each
 * device holds its own independent client Router Cache that has no way
 * to learn a write happened on another device. This closes that gap:
 * subscribe to Postgres change events for the signed-in user's own rows
 * (RLS-filtered server-side, not just by the client-side `filter` below —
 * see the negative test in e2e/realtime-sync.spec.ts) and call
 * router.refresh() so the next render picks up the fresh server data.
 *
 * Mounted once, at the shell level (app-shell-chrome.tsx), for every
 * authenticated page — not per-domain-screen. `userId` comes from the
 * server (app-shell.tsx's own getAuthedUser() call), never re-derived
 * client-side.
 */

// Deliberately scoped — see supabase/migrations/049_realtime_publication.sql
// for the full "why these and not more" reasoning. Kept in sync with that
// migration's ALTER PUBLICATION list; add a table in both places together.
const SYNCED_TABLES = [
  "prayers",
  "sunnah_logs",
  "tasks",
  "kill_list_items",
  "deen_habit_logs",
  "habit_logs",
  "body_metrics",
  "workout_sessions",
  "session_sets",
] as const;

// A burst of writes (e.g. confirming a workout session inserts several
// session_sets rows in quick succession) must not fire a
// router.refresh() per row — each refresh is a full RSC round trip.
// Coalesce anything within this window into a single refresh.
const REFRESH_DEBOUNCE_MS = 400;

export function RealtimeSyncProvider({ userId }: { userId: string | null }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSubscribedOnceRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    function scheduleRefresh() {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    }

    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function join() {
      // ROOT CAUSE (found 2026-08-26, deterministic repro in the PR/commit
      // this comment shipped with): a channel's postgres_changes RLS
      // scoping is fixed at JOIN time. `createBrowserClient`'s session
      // restore from cookies is ASYNC (GoTrueClient.initialize()) — if
      // channel.subscribe() fires before that resolves, the join goes out
      // under the anon role, RLS then matches zero rows for the lifetime
      // of that channel, and the channel still reports SUBSCRIBED. A
      // *later* auth-state-triggered `realtime.setAuth()` (the SDK's own
      // internal self-heal, or another explicit call) updates the socket's
      // general auth but does NOT retroactively re-scope the
      // already-established postgres_changes registration — proved by
      // signing in a NODE client (no React, no Strict Mode) after an
      // anon-role join: the socket ends up holding a valid session JWT,
      // status stays SUBSCRIBED throughout, and the event still never
      // arrives. Only a join whose access_token was already valid at
      // subscribe-call time ever receives anything.
      //
      // The fix: never let `subscribe()` race the session restore.
      // `getSession()` awaits GoTrueClient's own initialize() — the same
      // promise the SDK's internal auth listener depends on — so by the
      // time it resolves we have a definitive answer, and we set the
      // realtime auth OURSELVES from it rather than trusting the internal
      // listener to have already fired first (unspecified ordering, not
      // worth relying on).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      // One channel, one subscription per synced table — `user_id=eq.` is
      // a Postgres Changes server-side filter (not a client-side
      // discard), so Postgres itself only ever sends this client events
      // for its own rows; RLS on the publication's tables is the second,
      // independent layer underneath that filter, not a substitute for
      // it.
      channel = supabase.channel(`realtime-sync:${userId}:${Math.random().toString(36).slice(2)}`);
      for (const table of SYNCED_TABLES) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
          scheduleRefresh
        );
      }

      // React Strict Mode's dev-only double-invoke (mount, cleanup,
      // mount) is naturally handled here too: the phantom first mount's
      // cleanup sets `cancelled` before this async function ever reaches
      // its first await's resolution (getSession() is never instant), so
      // only the mount that survives ever calls subscribe() at all — no
      // dedicated defer-by-a-tick hack needed once the join is already
      // gated behind a real async step.
      channel.subscribe((status, err) => {
        if (status !== "SUBSCRIBED") {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("Realtime sync channel error", status, err);
          }
          return;
        }
        // The realtime-js client already retries the websocket connection
        // on its own after a network blip (a laptop lid closing and
        // reopening is exactly this) — but whatever changed on another
        // device WHILE this client was disconnected is, by definition,
        // invisible to the events themselves. Treat every SUCCESSFUL
        // (re)subscribe after the first as "might have missed something,"
        // and self-heal with one refresh — not on the very first mount,
        // which would just re-fetch data the initial server render already
        // has.
        if (hasSubscribedOnceRef.current) {
          scheduleRefresh();
        }
        hasSubscribedOnceRef.current = true;
      });
    }

    join();

    return () => {
      cancelled = true;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      hasSubscribedOnceRef.current = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
