"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { correctSessionLengthCore, type CorrectSessionResult } from "@/lib/business/session-correction-core";
import { revalidateBusinessScreens } from "@/lib/work/revalidate-screens";

/** Fix a Deep session that was left running: set its real length in minutes. */
export async function correctSessionLength(sessionId: string, minutes: number): Promise<CorrectSessionResult> {
  const { supabase, userId } = await requireUser();
  try {
    const res = await correctSessionLengthCore(supabase, userId, sessionId, minutes);
    if (res.ok) {
      revalidatePath("/insights");
      revalidatePath("/");
      revalidateBusinessScreens();
    }
    return res;
  } catch {
    return { ok: false, message: "Couldn't save that. Try again." };
  }
}
