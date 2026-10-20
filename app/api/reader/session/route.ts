import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/auth";
import { guardBeacon } from "@/lib/api/beacon-guard";
import { recordReaderSessionCore } from "@/lib/reader/server/core";

export const dynamic = "force-dynamic";

/** One reading stretch: ids, two timestamps and a few numbers. */
const MAX_BODY_BYTES = 2048;

/**
 * Reading-session write for the unload path (the last stretch before a hard tab close). Server Actions are cancelled
 * with the page; this is a keepalive POST. Same core as the recordReaderSession action, so scoping and validation match.
 */
export async function POST(request: NextRequest) {
  const guarded = await guardBeacon(request, MAX_BODY_BYTES);
  if (guarded instanceof NextResponse) return guarded;
  const timezone = (await getProfile())?.timezone ?? "UTC";
  const result = await recordReaderSessionCore(await createClient(), guarded.userId, timezone, guarded.body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
