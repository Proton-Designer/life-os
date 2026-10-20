import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { loginRedirectFor } from "@/lib/auth/login-redirect";
import { createShareImportCore, SHARE_MAX_BYTES } from "@/lib/reader/server/share";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Multipart overhead on top of the largest file we accept. */
const MAX_REQUEST_BYTES = SHARE_MAX_BYTES + 64 * 1024;

/**
 * POST share target (manifest.json share_target): the installed app appears in the OS share sheet and posts
 * title/text/url (and a pdf/epub/txt/md file) here. Creates + prepares the import for the signed-in user, then 303s to the
 * normal preview-and-confirm at /read/import?pending=<bookId>. Failures 303 to /read/import?error=... so the person sees
 * a readable message, never a raw JSON page. A signed-out share goes to sign-in and comes back to the import page (the
 * shared body itself cannot survive a redirect; the person is asked to share again).
 */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (query: string) => NextResponse.redirect(new URL(`/read/import${query}`, origin), 303);

  const sentFrom = request.headers.get("origin");
  if (sentFrom && sentFrom !== origin) return NextResponse.json({ ok: false, message: "Cross-site request refused." }, { status: 403 });

  const user = await getAuthedUser();
  if (!user) return NextResponse.redirect(new URL(loginRedirectFor("/read/import", ""), origin), 303);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return back(`?error=${encodeURIComponent("That was too large to share into the reader. Import it from the library instead.")}`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(`?error=${encodeURIComponent("That share couldn't be read. Try importing it again.")}`);
  }
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const entry = form.getAll("files").find((f): f is File => typeof f !== "string" && f.size > 0) ?? null;
  const file = entry ? { name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) } : null;

  const supabase = await createClient();
  const result = await createShareImportCore(supabase, user.id, { title: str("title"), text: str("text"), url: str("url"), file });
  return result.ok ? back(`?pending=${result.bookId}`) : back(`?error=${encodeURIComponent(result.message)}`);
}
