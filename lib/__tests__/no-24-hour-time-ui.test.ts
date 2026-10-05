import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app shows time in regular 12-hour form EVERYWHERE (the product owner's rule, 2026-10-05). Two things silently break
 * that, and both look fine in code review:
 *   - <input type="time">: its display follows the browser/OS locale, so a 24-hour locale shows "21:00". Use
 *     components/ui/time-field-12.tsx (stores "HH:MM", shows 12-hour).
 *   - toLocaleTimeString(): same locale dependency. Use formatClock12 / formatHHMM12 from lib/date-utils.ts.
 * This test is the regression signal: it scans the UI sources, so reintroducing either one fails CI-less preflight.
 */
const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components"];

const FORBIDDEN: { name: string; re: RegExp; hint: string }[] = [
  { name: 'native <input type="time">', re: /type=["']time["']/, hint: "use <TimeField12> (components/ui/time-field-12.tsx)" },
  { name: "toLocaleTimeString()", re: /\.toLocaleTimeString\s*\(/, hint: "use formatClock12 / formatHHMM12 (lib/date-utils.ts)" },
];

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/** Code lines only: drops whole-line comments (// and block-comment bodies) so a comment explaining the rule isn't a violation. */
export function violationsIn(source: string): { name: string; line: number; text: string; hint: string }[] {
  const found: { name: string; line: number; text: string; hint: string }[] = [];
  source.split("\n").forEach((text, i) => {
    const t = text.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    for (const f of FORBIDDEN) if (f.re.test(text)) found.push({ name: f.name, line: i + 1, text: t, hint: f.hint });
  });
  return found;
}

describe("no 24-hour / locale-dependent time in the UI", () => {
  it("POSITIVE CONTROL: the scanner really flags both patterns (a check that examines nothing reports success)", () => {
    expect(violationsIn('<input type="time" value={x} />')).toHaveLength(1);
    expect(violationsIn("<Input type='time' />")).toHaveLength(1);
    expect(violationsIn("d.toLocaleTimeString([], { hour: 'numeric' })")).toHaveLength(1);
    expect(violationsIn("// <input type=\"time\"> is locale-dependent")).toHaveLength(0);
    expect(violationsIn(" * toLocaleTimeString() flips to 24-hour")).toHaveLength(0);
  });

  it("scans a real, non-trivial number of source files", () => {
    const files = SCAN_DIRS.flatMap((d) => listSources(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(300);
  });

  it("no UI source uses a native time input or toLocaleTimeString", () => {
    const problems: string[] = [];
    for (const file of SCAN_DIRS.flatMap((d) => listSources(join(ROOT, d)))) {
      for (const v of violationsIn(readFileSync(file, "utf8"))) {
        problems.push(`${file.replace(ROOT + "/", "")}:${v.line}  ${v.name}  -> ${v.hint}\n    ${v.text}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
