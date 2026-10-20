import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardBeacon } from "@/lib/api/beacon-guard";
import { saveReaderPositionCore } from "@/lib/reader/server/core";

export const dynamic = "force-dynamic";

/** A bookmark is a handful of numbers; anything bigger is not from the reader. */
const MAX_BODY_BYTES = 2048;

/**
 * Bookmark write for the unload path. navigator.sendBeacon / fetch({keepalive}) can't wait for a Server
 * Action (those are queued one at a time per client and are cancelled with the page), so the reader POSTs
 * here when the tab hides or closes. Same auth (session cookie) and the same newest-client-timestamp-wins
 * rule as the saveReaderPosition action — both call saveReaderPositionCore -> reader_save_position().
 * Origin, size and parsing guards live in guardBeacon (shared with the session and settings beacons).
 */
export async function POST(request: NextRequest) {
  const guarded = await guardBeacon(request, MAX_BODY_BYTES);
  if (guarded instanceof NextResponse) return guarded;
  const result = await saveReaderPositionCore(await createClient(), guarded.userId, guarded.body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
