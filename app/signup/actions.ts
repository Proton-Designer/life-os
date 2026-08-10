"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signUp(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  // Whether signUp returns an active session depends on this Supabase
  // project's "Confirm email" setting — with it on (Supabase's default),
  // data.session is null until the user clicks the emailed confirmation
  // link, so there's nothing to redirect into yet.
  if (!data.session) {
    return { message: "Check your email to confirm your account, then sign in." };
  }

  redirect("/");
}
