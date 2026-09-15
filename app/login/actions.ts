"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/safe-next";

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });
  if (error) return { error: error.message };
  // P4-13: return to a same-origin `next` (e.g. the MCP OAuth consent screen); anything else goes Home.
  redirect(safeNextPath(formData.get("next") as string | null) ?? "/");
}
