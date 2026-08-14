import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route in this app is dynamic (auth-gated), so this is the
    // relevant knob — `static` doesn't apply here. Every mutation already
    // calls revalidatePath() to bust this cache (that's the real
    // invalidation mechanism, verified live — see PROJECT_STATUS.md), so
    // this is a safety net for a missed revalidatePath call, not a data
    // freshness guarantee on its own — 1hr is long enough that no real
    // session hits it. Client cache is per-browser-session, not shared
    // across users/devices.
    staleTimes: {
      dynamic: 3600,
    },
  },
};

export default nextConfig;
