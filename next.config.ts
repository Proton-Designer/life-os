import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route in this app is dynamic (auth-gated), so this is the
    // relevant knob — `static` doesn't apply here. Every mutation already
    // calls revalidatePath() to bust the SERVER's cache; this knob only
    // governs each device's own independent client Router Cache, which
    // revalidatePath cannot reach. That gap is the root cause of Ayman's
    // "changes on my phone don't show on my laptop" report (2026-08-25/26
    // batch 2, item 2) — same-device navigation stays correctly fresh via
    // revalidatePath; only a SECOND device's already-open client cache is
    // blind to a write it didn't make.
    //
    // RealtimeSyncProvider (components/realtime/realtime-sync-provider.tsx)
    // is the real fix — a Postgres Changes event calling router.refresh()
    // directly, with no wait — but it's HELD, not mounted (see the comment
    // in components/shell/app-shell-chrome.tsx and the writeup in
    // e2e/realtime-sync.spec.ts): it reaches SUBSCRIBED but intermittently
    // never receives events in the live browser, root cause unconfirmed.
    //
    // Until it's re-enabled, THIS VALUE is the only lever on that symptom
    // at all — at the old 3600s, a second device could serve a full hour
    // of stale data after a write elsewhere, which is indistinguishable
    // from the bug not being addressed. 60s doesn't fix cross-device sync
    // (nothing here does, tonight), but it bounds "stale until the next
    // navigation happens to land past 60s" instead of "stale for up to an
    // hour" — a real, feelable improvement standing in for the realtime
    // layer until it's mounted. The cost is more RSC round trips on
    // navigation (real on cellular, bounded, and Next prefetches on
    // hover/viewport regardless) — raise this back toward 3600 if that
    // proves too chatty once RealtimeSyncProvider is live and this reverts
    // to being a pure safety net again.
    staleTimes: {
      dynamic: 60,
    },
  },
};

export default nextConfig;
