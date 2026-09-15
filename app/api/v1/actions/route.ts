import { handleRestOptions, handleRestRequest } from "@/lib/agent-api/rest/handler";

// P4-17: /api/v1 REST adapter. Every route file is this same thin entry; the
// whole pipeline (auth, grammar, dispatch, errors, CORS) is lib/agent-api/rest/handler.ts.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRestRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRestRequest(request);
}

export async function OPTIONS(): Promise<Response> {
  return handleRestOptions();
}
