import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { registerOAuthClient } from "@/lib/mcp/oauth";

/**
 * RFC 7591 Dynamic Client Registration. Claude's connector UI requires DCR
 * (R1/PROGRAM-PLAN.md — it still targets the 2025-11-25 auth spec, where DCR
 * is not yet deprecated in favor of CIMD); this is that endpoint.
 *
 * PUBLIC AND UNAUTHENTICATED, BY DESIGN — RFC 7591 assumes no prior
 * relationship between client and server, which is the entire point of
 * dynamic registration. This does NOT grant access to anything by itself:
 * see app/api/mcp/oauth/authorize/route.ts's mandatory consent screen for
 * why registering a client is closer to signing a guestbook than to gaining
 * entry — the red-team finding (PROGRAM-PLAN.md, R2 resolution) is that this
 * endpoint's public nature is exactly why that consent step cannot be
 * skipped, not that this endpoint itself is unsafe to expose.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Request body must be a JSON object." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const result = await registerOAuthClient(supabase, body as Record<string, unknown>);

  if (!result.ok) {
    return NextResponse.json({ error: result.error, error_description: result.message }, { status: result.status });
  }
  return NextResponse.json(result.client, { status: 201 });
}
