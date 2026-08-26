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
    // One channel, one subscription per synced table — `user_id=eq.` is a
    // Postgres Changes server-side filter (not a client-side discard), so
    // Postgres itself only ever sends this client events for its own
    // rows; RLS on the publication's tables is the second, independent
    // layer underneath that filter, not a substitute for it.
    const channel = supabase.channel(`realtime-sync:${userId}:${Math.random().toString(36).slice(2)}`);
    for (const table of SYNCED_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` },
        scheduleRefresh
      );
    }

    // React Strict Mode's dev-only double-invoke (mount, cleanup, mount)
    // otherwise sends the server a phx_join immediately followed by a
    // phx_leave for the SAME (schema, table, filter) content — diagnosed
    // live: this leaves the surviving second mount's channel reporting
    // "SUBSCRIBED" while the server's underlying postgres_changes
    // registration for that content was torn down by the first mount's
    // leave and never actually re-attached, so no event ever arrives.
    // Deferring the actual join by a tick means the phantom first mount's
    // cleanup cancels it before any phx_join is ever sent — only a mount
    // that survives to the next microtask (the real one) ever joins, so
    // no leave/rejoin churn happens at all.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
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
    });

    return () => {
      cancelled = true;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      hasSubscribedOnceRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
