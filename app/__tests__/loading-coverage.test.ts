import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// NAV-01b: every page segment under the app shell has its own loading.tsx. Next prefetches a dynamic
// route only up to its nearest loading boundary and shows that boundary while the page streams, so a
// page without one inherits a parent's skeleton of the WRONG shape (the jumpy swap) and prefetches less.
const ROOT = path.join(process.cwd(), "app");
const GROUPS = ["(app)", "(capture)"];

// Pages that do nothing but redirect (no data, no UI): a skeleton would only flash. Each must still
// contain redirect( -- checked below, so this list cannot quietly hide a real page.
const REDIRECT_ONLY = new Set([
  "(app)/personal",
  "(app)/weekly-review",
  "(app)/goals",
  "(app)/habits",
  "(app)/worries",
  "(app)/open",
  "(app)/open/today",
  "(app)/close/replan",
]);

function pageDirs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "api") continue;
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(path.join(full, "page.tsx"))) out.push(path.relative(ROOT, full));
    pageDirs(full, out);
  }
  return out;
}

function segmentsMissingLoading(dirs: string[], has: (d: string) => boolean): string[] {
  return dirs.filter((d) => !REDIRECT_ONLY.has(d) && !has(d));
}

const pages = GROUPS.flatMap((g) => pageDirs(path.join(ROOT, g)));
const hasLoading = (d: string) => existsSync(path.join(ROOT, d, "loading.tsx"));

describe("every page segment has a loading.tsx (NAV-01b)", () => {
  it("finds the pages it is supposed to guard (positive control: the scan sees real segments)", () => {
    expect(pages).toContain("(app)/week");
    expect(pages).toContain("(app)/settings");
    expect(pages.length).toBeGreaterThan(20);
  });

  it("no non-redirect page segment is missing its loading.tsx", () => {
    expect(segmentsMissingLoading(pages, hasLoading)).toEqual([]);
  });

  it("positive control: pretending /week had none makes the guard report it", () => {
    expect(segmentsMissingLoading(pages, (d) => d !== "(app)/week" && hasLoading(d))).toEqual(["(app)/week"]);
  });

  it("the redirect-only exemptions really are redirect pages", () => {
    for (const d of REDIRECT_ONLY) {
      const src = readFileSync(path.join(ROOT, d, "page.tsx"), "utf8");
      expect(src, d).toMatch(/redirect\(/);
    }
  });
});
