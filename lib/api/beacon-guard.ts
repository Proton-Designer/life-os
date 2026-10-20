import { NextResponse, type NextRequest } from "next/server";
import { getAuthedUser } from "@/lib/supabase/auth";

type Refusal = NextResponse<{ ok: false; message: string }>;

const refuse = (message: string, status: number): Refusal => NextResponse.json({ ok: false as const, message }, { status });

/**
 * Shared front door for unload-time writes (navigator.sendBeacon / fetch keepalive), which can't use Server Actions:
 * same-origin only (Origin + Sec-Fetch-Site), declared and counted size cap, signed-in user, JSON body read as text
 * (sendBeacon sends text/plain to stay a "simple" request). Returns the user and parsed body, or the response to send.
 */
export async function guardBeacon(request: NextRequest, maxBytes: number): Promise<{ userId: string; body: unknown } | Refusal> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return refuse("Cross-site request refused.", 403);
  // Fetch metadata is set by the browser and can't be forged by page script: refuse anything that isn't ours.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse("Cross-site request refused.", 403);
  // Refuse on the declared length before reading anything; the byte count after the read still decides.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return refuse("Request too large.", 413);

  const user = await getAuthedUser();
  if (!user) return refuse("Not signed in.", 401);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return refuse("Request too large.", 413);
  try {
    return { userId: user.id, body: JSON.parse(text) };
  } catch {
    return refuse("That request isn't valid.", 400);
  }
}
