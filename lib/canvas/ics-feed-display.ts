/**
 * P3-13 -- a real Canvas ICS feed URL always ends in literal ".ics", so a
 * plain `last4` of the whole string would always display "".ics"" for
 * every user, telling nobody anything. Strips that fixed suffix first so
 * the displayed last4 actually reflects the URL's own distinguishing
 * (secret) tail instead.
 *
 * OWN FILE, NOT in canvas-actions.ts: that file is `"use server"`, and
 * every export from a `"use server"` file must be an async Server
 * Action -- a plain sync helper there breaks the Next.js build (same
 * class of bug as the habits/morning-routine constants extractions
 * earlier tonight). This is a shared, client-safe pure function: both
 * canvas-actions.ts's Server Action (computing the value to store) and
 * canvas-settings.tsx's Client Component (computing the identical value
 * for its optimistic update) import it from here.
 */
export function icsFeedDisplaySource(url: string): string {
  return url.replace(/\.ics$/i, "");
}
