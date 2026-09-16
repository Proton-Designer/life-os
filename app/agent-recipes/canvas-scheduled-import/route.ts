import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * P4-20: serves docs/agent-recipes/canvas-scheduled-import.md's real
 * content live, so /agent.md's link to it (CANVAS-LITE-02 wrote the doc
 * and flagged it wasn't served anywhere) is a real link, not a dead one.
 * One source of truth -- this route never duplicates the doc's text, it
 * reads the same file a human browsing the repo would.
 */
export const dynamic = "force-dynamic";

const RECIPE_PATH = join(process.cwd(), "docs", "agent-recipes", "canvas-scheduled-import.md");

export async function GET(): Promise<Response> {
  try {
    const content = await readFile(RECIPE_PATH, "utf-8");
    return new Response(content, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch {
    return new Response("# Recipe temporarily unavailable\n", { status: 500, headers: { "content-type": "text/markdown; charset=utf-8" } });
  }
}
