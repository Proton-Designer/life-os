import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route in this app is dynamic (auth-gated), so this is the
    // relevant knob — `static` doesn't apply here. Every mutation already
    // calls revalidatePath() to bust the SERVER's cache; this knob only
    // governs each device's own independent client Router Cache, which
    // revalidatePath cannot reach — that gap is the actual root cause of
    // "changes on my phone don't show on my laptop" (2026-08-25/26 batch
    // 2, item 2), not a bug in revalidatePath itself.
    //
    // RealtimeSyncProvider (components/realtime/realtime-sync-provider.tsx)
    // is the intended fix — a Postgres Changes event calling
    // router.refresh() directly — but it's HELD, not mounted (see the
    // comment in components/shell/app-shell-chrome.tsx and the writeup in
    // e2e/realtime-sync.spec.ts): it reaches SUBSCRIBED but intermittently
    // never receives events in the live browser, root cause unconfirmed.
    // Until it's re-enabled, this is back to being a plain cache-staleness
    // knob with no realtime layer underneath it — 3600s, as before.
    staleTimes: {
      dynamic: 3600,
    },
  },
};

export default nextConfig;
