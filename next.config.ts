import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route in this app is dynamic (auth-gated), so this is the
    // relevant knob; `static` doesn't apply here. Every mutation already
    // calls revalidatePath() for its OWN device (and revalidatePath also
    // clears that device's Router Cache). This value governs how long a
    // visited page is reused on a revisit with NO fetch (Home -> Personal
    // -> Home is instant while it holds).
    //
    // NAV-01a: 1800 s (30 min). It had been cut to 60 s as a stand-in for
    // cross-device freshness, which made every revisit after a minute
    // refetch the whole page (1-2 s on a real account). Cross-device is now
    // covered by two other mechanisms, so this is back to being a safety
    // net: RealtimeSyncProvider (mounted; router.refresh() on a change) and
    // components/shell/focus-refresh.tsx (router.refresh() when the tab/PWA
    // returns after >= 60 s away). router.refresh() also drops every cached
    // page, so nothing stale survives the first return. 30 min rather than
    // 60: a device that stays focused and never loses realtime still can't
    // serve a page older than half an hour. Polling Server Actions never
    // call revalidatePath/refresh, so they never invalidate this cache.
    staleTimes: {
      dynamic: 1800,
    },
  },
  // P3-08: the public share-view route is a user's own study material,
  // never a public search result. app/share/[token]/page.tsx already sets
  // the <meta name="robots"> tag via its own `metadata` export; a Server
  // Component can't add an arbitrary response HEADER directly, so the
  // matching X-Robots-Tag lives here instead, scoped only to this one path.
  async headers() {
    return [
      {
        source: "/share/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
