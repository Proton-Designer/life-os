import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { AuthSubmitButton } from "@/components/auth/submit-button";
import { signIn } from "./actions";
import { safeNextPath } from "@/lib/auth/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  // P4-13: carried through sign-in (and through a failed attempt) so the MCP OAuth consent flow resumes.
  const next = safeNextPath(rawNext);

  async function signInAction(formData: FormData) {
    "use server";
    const result = await signIn(formData);
    if (result?.error) {
      const { redirect } = await import("next/navigation");
      const keepNext = safeNextPath(formData.get("next") as string | null);
      redirect(`/login?error=${encodeURIComponent(result.error)}${keepNext ? `&next=${encodeURIComponent(keepNext)}` : ""}`);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      {/* Same rounded-2xl/border-border/40/bg-card shell every Panel in the
          app uses (Phase B's card taxonomy) rather than shadcn's default
          Card — auth screens read as part of the same system, not a
          separate template. The body's own oxblood radial glow (globals.css)
          already shows through here; no per-page setup needed. */}
      <div className="w-full max-w-sm rounded-2xl border border-border/40 bg-card p-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-medium">Life OS</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        <form action={signInAction} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AuthSubmitButton label="Sign in" pendingLabel="Signing in…" />
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-foreground underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
