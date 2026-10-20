import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { saveReaderPositionCore } from "@/lib/reader/server/core";

export const dynamic = "force-dynamic";

/** A bookmark is a handful of numbers; anything bigger is not from the reader. */
const MAX_BODY_BYTES = 2048;

/**
 * Bookmark write for the unload path. navigator.sendBeacon / fetch({keepalive}) can't wait for a Server
 * Action (those are queued one at a time per client and are cancelled with the page), so the reader POSTs
 * here when the tab hides or closes. Same auth (session cookie) and the same newest-client-timestamp-wins
 * rule as the saveReaderPosition action — both call saveReaderPositionCore -> reader_save_position().
 *
 * The body is JSON, sent as text/plain by sendBeacon (a Blob typed application/json would trigger a CORS
 * preflight), so it is read as text and parsed here. A cross-site Origin is refused.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ ok: false, message: "Cross-site request refused." }, { status: 403 });
  }

  // Fetch metadata is set by the browser and can't be forged by page script: refuse anything that isn't ours.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ ok: false, message: "Cross-site request refused." }, { status: 403 });
  }
  // Refuse on the declared length before reading anything; the byte count after the read still decides.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, message: "Request too large." }, { status: 413 });
  }

  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, message: "Request too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, message: "That request isn't valid." }, { status: 400 });
  }

  const supabase = await createClient();
  const result = await saveReaderPositionCore(supabase, user.id, body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
