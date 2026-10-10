import { getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";

/**
 * Server-side Deen Mode gate for Server Actions (the UI hides the controls,
 * but a Server Action is a public POST endpoint -- hiding is not refusing).
 * Reads the request-cached profile, so it costs nothing where a page already
 * loaded it. OFF refuses the action; it never touches deen data (R4).
 * Fails closed via isDeenModeOn.
 */
export async function isDeenModeOnForRequest(): Promise<boolean> {
  return isDeenModeOn(await getProfile());
}

/**
 * The request's timezone from the SAME cached profile row the guard already
 * read (getProfile is cache()d per request) -- replaces a second
 * `profiles.timezone` round trip (fetchTimezone) on every hot Deen tap.
 */
export async function getRequestTimezone(): Promise<string> {
  return (await getProfile())?.timezone ?? "UTC";
}

export const DEEN_MODE_OFF_MESSAGE = "Faith Mode is off";
