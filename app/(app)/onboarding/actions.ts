"use server";

import { redirect } from "next/navigation";
import { updateProfile, type ProfileUpdatable } from "@/app/(app)/settings/actions";

export async function completeOnboarding(
  fields: Omit<ProfileUpdatable, "pin" | "pin_hash" | "onboarding_completed">
): Promise<void> {
  await updateProfile({ ...fields, onboarding_completed: true });
  redirect("/");
}
