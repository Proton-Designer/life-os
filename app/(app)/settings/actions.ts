"use server";

import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/supabase/database.types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

// Every user-editable profiles column. `pin` is a virtual field — a raw PIN
// gets hashed before storage, never persisted as-is.
export type ProfileUpdatable = Partial<{
  display_name: string;
  prayer_calc_method: string;
  asr_madhab: "standard" | "hanafi";
  location_lat: number;
  location_lng: number;
  location_label: string;
  timezone: string;
  pin_lock_enabled: boolean;
  pin: string;
  pin_hash: string | null;
  checkin_window_start: string;
  checkin_window_end: string;
  checkin_interval_minutes: number;
  traveling_mode: boolean;
  onboarding_completed: boolean;
}>;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

export async function updateProfile(fields: ProfileUpdatable): Promise<void> {
  const { supabase, userId } = await requireUser();

  const update: Record<string, unknown> = { ...fields };

  if ("pin" in update) {
    const rawPin = update.pin as string | undefined;
    delete update.pin;
    update.pin_hash = rawPin ? await bcrypt.hash(rawPin, 10) : null;
  }

  // Defense-in-depth: never let a direct pin_hash write persist something
  // that isn't actually a bcrypt hash (a real one is a fixed-format,
  // fixed-length string — a raw 4-6 digit PIN could never match).
  if (typeof update.pin_hash === "string" && !BCRYPT_HASH_PATTERN.test(update.pin_hash)) {
    throw new Error(
      "pin_hash must be a bcrypt hash — pass a raw PIN via the `pin` field instead, it will be hashed automatically."
    );
  }

  // Upsert, not update: a brand-new auth user has no profiles row yet
  // (nothing creates one automatically) — onboarding is what's expected to
  // create it. Update-only would silently no-op for that user.
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: userId, ...update } as Database["public"]["Tables"]["profiles"]["Insert"],
      { onConflict: "user_id" }
    );
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}
