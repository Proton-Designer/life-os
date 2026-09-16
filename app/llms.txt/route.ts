import { renderGenericAgentDoc } from "@/lib/agent-api/agent-md";

// P4-20: the llms.txt convention (llmstxt.org) at the well-known root path.
// Same content as /agent.md -- one generic doc, two paths an agent might
// look for it at, per the board file's own AC.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  return new Response(renderGenericAgentDoc(origin), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
}
