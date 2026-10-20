import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardBeacon } from "@/lib/api/beacon-guard";
import { updateReaderSettingsCore } from "@/lib/reader/server/core";

export const dynamic = "force-dynamic";

/** A settings patch is a few small fields (the voice id is the longest). */
const MAX_BODY_BYTES = 2048;

/** Reader-settings write for the unload path (a change made in the last moments before the tab closes). */
export async function POST(request: NextRequest) {
  const guarded = await guardBeacon(request, MAX_BODY_BYTES);
  if (guarded instanceof NextResponse) return guarded;
  const result = await updateReaderSettingsCore(await createClient(), guarded.userId, guarded.body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
