import type { NextRequest } from "next/server";
import { shellRead } from "@/lib/api/shell-read";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { isDeenModeOnForRequest } from "@/lib/deen/deen-mode-guard";
import { getTodayDistractionCount, getSessionDistractionCount } from "@/lib/distractions/queries";

export const dynamic = "force-dynamic";

/**
 * NAV-02: replaces getTodayDistractionCountForNow (the topbar badge) and getSessionDistractionCountForNow
 * (`?sessionId=`, the capture dialog's "N this session"). A session id that is not the caller's reads 0
 * (the query is scoped to user_id), never a hint that it exists.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  return shellRead(async (userId) => {
    const supabase = await createClient();
    if (sessionId) return getSessionDistractionCount(supabase, userId, sessionId);
    const timezone = (await getProfile())?.timezone ?? "UTC";
    return getTodayDistractionCount(supabase, userId, localDateString(new Date(), timezone), await isDeenModeOnForRequest());
  });
}
