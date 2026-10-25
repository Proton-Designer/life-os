/**
 * Display helpers for the Home Morning Brief panel. Client-safe (no server-only imports): the panel is a client component.
 * An agent-written brief (day.morning_brief.write, migration 274) is stored with provider 'mcp' and model = the connecting
 * token's name, or 'agent' when it has none; the built-in nightly brief is shown unlabeled.
 */

export const BRIEF_CLAMP_CHARS = 420;
export const BRIEF_CLAMP_LINES = 8;

export function briefSourceLabel(provider: string | null | undefined, model: string | null | undefined): string | null {
  if (provider !== "mcp") return null;
  const name = (model ?? "").trim();
  return `Written by ${name && name !== "agent" ? name : "your agent"} via your connector`;
}

/** Blank lines separate paragraphs; a single line break stays inside its paragraph. */
export function briefParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function briefNeedsClamp(text: string): boolean {
  return text.length > BRIEF_CLAMP_CHARS || text.split("\n").length > BRIEF_CLAMP_LINES;
}
