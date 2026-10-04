import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// NAV-01b: Next prefetches a dynamic route behind <Link prefetch> (the whole route, not just the shell up
// to loading.tsx), so every link in all four nav renderers -- desktop AND mobile, legacy AND domains --
// sets it explicitly. (Next's own default for a dynamic page is the loading boundary only.)
const FILES = ["sidebar-nav.tsx", "mobile-island.tsx", "tab-sidebar-nav.tsx", "tab-mobile-island.tsx"];
const links = (src: string) => [...src.matchAll(/<Link\b[\s\S]*?>/g)].map((m) => m[0]);

describe("nav links prefetch", () => {
  it.each(FILES)("%s: every <Link> carries the prefetch prop", (file) => {
    const src = readFileSync(path.join(process.cwd(), "components/shell", file), "utf8");
    const found = links(src);
    expect(found.length).toBeGreaterThan(0);
    for (const tag of found) expect(tag, tag).toMatch(/\bprefetch\b/);
  });

  it("positive control: a link without it would be caught", () => {
    expect(links('<Link href="/x" className="a">')[0]).not.toMatch(/\bprefetch\b/);
  });
});
