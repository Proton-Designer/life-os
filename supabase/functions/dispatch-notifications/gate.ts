// Pure gate for the prayer push, kept in its own import-free file so the
// Next.js unit tests can import it (index.ts pulls jsr:/npm: modules vitest
// cannot resolve). Mirrors lib/deen/deen-mode.ts's isDeenModeOn -- the edge
// runtime cannot import across that boundary, same deliberate-duplicate
// stance as the prayer-time math in index.ts. Keep the two in sync.
//
// Deen Mode OFF = no prayer push, and no prayer-time computation either.
// Fails CLOSED: only the literal boolean true sends.
export function shouldSendPrayerPush(profile: {
  deen_mode?: boolean | null;
  location_lat?: number | null;
  location_lng?: number | null;
}): boolean {
  return profile.deen_mode === true && profile.location_lat != null && profile.location_lng != null;
}
