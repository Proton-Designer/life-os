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

export const DEEN_MODE_OFF_MESSAGE = "Deen Mode is off";
