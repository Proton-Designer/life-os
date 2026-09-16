import { renderGenericAgentDoc } from "@/lib/agent-api/agent-md";

// P4-20: unauthenticated, zero account data -- see lib/agent-api/agent-md.ts's
// header for why this is deliberately the SAME renderer /llms.txt uses.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  return new Response(renderGenericAgentDoc(origin), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
}
