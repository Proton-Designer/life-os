"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { setWeekdayBaselinesCore, clearWeekdayBaselinesCore } from "@/lib/settings/actions-core";

/**
 * P4-23: both actions write through the same core the MCP connector uses,
 * which ensures the `user_settings` row exists and refuses to report success
 * when the UPDATE matched 0 rows. Before this, an account with no row (10/30
 * in production) saw "Saved" while nothing was stored.
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Could not save weekday baselines";
}

/**
 * Writing `user_settings.weekday_baselines` (migration 122).
 *
 * TWO DISTINCT WRITES, DELIBERATELY. `save` stores a seven-element array;
 * `clear` stores NULL. They are separate entry points because the values they
 * write mean different things and one must never stand in for the other:
 *
 *   [0,0,0,0,0,0,0]  seven deliberate rest days — a real, considered week
 *   NULL             never set — the Day Won comparison is ABSENT
 *
 * CollegeOS Eng 1 raised this while verifying `122`: the schema keeps the
 * distinction, but only the UI can preserve it, and a form that "helpfully"
 * treats an all-zero week as unset would destroy it at the first save. So
 * there is no code path here that turns one into the other.
 */

export async function saveWeekdayBaselines(values: number[]): Promise<{ ok: true } | { error: string }> {
  const user = await getAuthedUser();
  if (!user) return { error: "Not signed in" };

  if (values.length !== 7) return { error: "A week has seven days" };
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v > 12) {
      return { error: "Each day must be a whole number of hours from 0 to 12" };
    }
  }

  const supabase = await createClient();
  try {
    await setWeekdayBaselinesCore(supabase, user.id, values);
  } catch (e) {
    return { error: errorMessage(e) };
  }

  revalidatePath("/settings");
  revalidatePath("/close");
  return { ok: true };
}

/** Back to never-set. NOT the same as a week of zeros — see the note above. */
export async function clearWeekdayBaselines(): Promise<{ ok: true } | { error: string }> {
  const user = await getAuthedUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  try {
    await clearWeekdayBaselinesCore(supabase, user.id);
  } catch (e) {
    return { error: errorMessage(e) };
  }

  revalidatePath("/settings");
  revalidatePath("/close");
  return { ok: true };
}
