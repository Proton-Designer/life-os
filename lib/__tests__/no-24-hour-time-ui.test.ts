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
  // A bare toLocaleString() prints date AND time in the browser's locale ("13:06" on a 24-hour one).
  { name: "toLocaleString() with no arguments", re: /\.toLocaleString\s*\(\s*\)/, hint: "use formatDateTime12 (lib/date-utils.ts) for a timestamp, or toLocaleDateString for a pure date" },
];

/**
 * Multi-line: a `new Intl.DateTimeFormat(locale, { ... hour ... })` that shows an hour must say `hour12: true`, or it follows
 * the runtime's locale (and `Intl.DateTimeFormat(undefined, ...)` is exactly the browser's: "13:06" on a 24-hour one). Code that
 * only COMPUTES with the clock should use localClockHHMM; code that SHOWS it should use formatClock12 / formatHHMM12 /
 * formatDateTime12 (lib/date-utils.ts), so this rule has no legitimate exception. Comment lines are blanked first.
 */
export function intlTimeViolationsIn(source: string): { line: number; text: string }[] {
  const code = source
    .split("\n")
    .map((l) => {
      const t = l.trim();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : l;
    })
    .join("\n");
  const found: { line: number; text: string }[] = [];
  const re = /Intl\.DateTimeFormat\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    // The argument list, up to its matching close paren (options objects hold no parentheses of their own in this codebase;
    // the scan balances them anyway).
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    const args = code.slice(m.index, i);
    const showsTime = /\b(hour|timeStyle|dayPeriod)\s*:/.test(args);
    if (showsTime && !/hour12\s*:\s*true/.test(args)) found.push({ line: code.slice(0, m.index).split("\n").length, text: args.replace(/\s+/g, " ").slice(0, 110) });
  }
  return found;
}

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
    expect(violationsIn("{d.toLocaleString()}")).toHaveLength(1);
    expect(violationsIn("d.toLocaleString('en-US', { dateStyle: 'short' })")).toHaveLength(0);
  });

  it("POSITIVE CONTROL: the Intl scanner flags an hour-showing DateTimeFormat without hour12: true, across lines, and only that", () => {
    // the exact line that used to be in the Lock-In overlay
    expect(intlTimeViolationsIn(`const clockLabel = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(now);`)).toHaveLength(1);
    expect(intlTimeViolationsIn('new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23" })')).toHaveLength(1);
    expect(intlTimeViolationsIn('new Intl.DateTimeFormat("en-US", { timeStyle: "short" })')).toHaveLength(1);
    // allowed: explicit 12-hour, a pure date, a timezone lookup, and a comment that mentions the pattern
    expect(intlTimeViolationsIn('new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true })')).toHaveLength(0);
    expect(intlTimeViolationsIn('new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" })')).toHaveLength(0);
    expect(intlTimeViolationsIn("Intl.DateTimeFormat().resolvedOptions().timeZone")).toHaveLength(0);
    expect(intlTimeViolationsIn("// new Intl.DateTimeFormat(undefined, { hour: 'numeric' })")).toHaveLength(0);
    // two calls in one file: only the bad one is reported, with its line
    const two = intlTimeViolationsIn('const a = new Intl.DateTimeFormat("en-US", { month: "short" });\nconst b = new Intl.DateTimeFormat("en-US", { hour: "numeric" });');
    expect(two).toEqual([{ line: 2, text: expect.stringContaining("hour") }]);
  });

  it("scans a real, non-trivial number of source files", () => {
    const files = SCAN_DIRS.flatMap((d) => listSources(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(300);
  });

  it("no UI source shows a time through a locale-dependent Intl.DateTimeFormat", () => {
    const problems: string[] = [];
    for (const file of SCAN_DIRS.flatMap((d) => listSources(join(ROOT, d)))) {
      for (const v of intlTimeViolationsIn(readFileSync(file, "utf8"))) {
        problems.push(`${file.replace(ROOT + "/", "")}:${v.line}  ${v.text}\n    -> use formatClock12 / formatHHMM12 / formatDateTime12 (lib/date-utils.ts), or localClockHHMM to compute`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
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
