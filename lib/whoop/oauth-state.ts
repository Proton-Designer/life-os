/**
 * P3-18 -- shared between the authorize and callback routes so the
 * cookie name/lifetime can't silently drift between the two halves of
 * the CSRF-state check. No "server-only"/"use server" -- both consumers
 * are plain Route Handlers, not Server Components or Server Actions.
 */
export const WHOOP_OAUTH_STATE_COOKIE = "whoop_oauth_state";
/** 10 minutes -- generous for a user to complete Whoop's own consent screen, short enough that a stale, unused state value doesn't linger. */
export const WHOOP_OAUTH_STATE_MAX_AGE_SECONDS = 600;
