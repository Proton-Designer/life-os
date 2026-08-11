import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Every route in this app is dynamic (auth-gated), so this is the
    // relevant knob — `static` doesn't apply here. Lets a revisit within
    // 30s of leaving a page reuse the client-cached RSC payload instead of
    // re-fetching, on top of the getUser()/getProfile() server-side dedup.
    // Client cache is per-browser-session, not shared across users/devices,
    // and revalidatePath() still busts it on mutation — verified live, see
    // PROJECT_STATUS.md.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
