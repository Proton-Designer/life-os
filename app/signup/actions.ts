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

  // Straight to /onboarding, NOT to "/". A brand-new signup has no profiles
  // row, so "/" would immediately bounce to /onboarding anyway — but that
  // second hop is thrown from inside AppLayout's <Suspense fallback={null}>
  // AFTER streaming has started, so Next can no longer issue a real 307 and
  // degrades to a client-side redirect. Observed result: /onboarding rendered
  // 16KB of scripts and ZERO visible content — every new signup landed on a
  // blank page. Redirecting straight here removes the chain, and it is always
  // the correct destination for an account that cannot yet have a profile.
  redirect("/onboarding");
}
