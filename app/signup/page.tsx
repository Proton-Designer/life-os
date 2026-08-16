import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { signUp } from "./actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  async function signUpAction(formData: FormData) {
    "use server";
    const result = await signUp(formData);
    if (result?.error) {
      const { redirect } = await import("next/navigation");
      redirect(`/signup?error=${encodeURIComponent(result.error)}`);
    }
    if (result?.message) {
      const { redirect } = await import("next/navigation");
      redirect(`/signup?message=${encodeURIComponent(result.message)}`);
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
          <p className="text-sm text-muted-foreground">Create an account</p>
        </div>
        <form action={signUpAction} className="flex flex-col gap-4">
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          )}
          <Button type="submit" className="w-full">
            Sign up
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
