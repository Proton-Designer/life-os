import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function signInAction(formData: FormData) {
    "use server";
    const result = await signIn(formData);
    if (result?.error) {
      const { redirect } = await import("next/navigation");
      redirect(`/login?error=${encodeURIComponent(result.error)}`);
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
          <Button type="submit" className="w-full">
            Sign in
          </Button>
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
