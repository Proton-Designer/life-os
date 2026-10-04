/**
 * Deen Mode (migration 251, `profiles.deen_mode`) -- the single switch every
 * religious surface reads. Default OFF; OFF is a render/behaviour gate only
 * and never deletes or mutates deen data.
 *
 * Framework-free on purpose (no React, no Supabase, no next/*): safe to
 * import from Server Components, Client Components, route handlers and the
 * MCP layer alike.
 *
 * Fails CLOSED: anything other than the literal boolean `true` -- null,
 * undefined, a missing profile row, a missing column (migration not yet
 * applied), a truthy string -- reads as OFF, so a surface never shows
 * religious content on a guess.
 */
export function isDeenModeOn(profile: { deen_mode?: boolean | null } | null | undefined): boolean {
  return profile?.deen_mode === true;
}
