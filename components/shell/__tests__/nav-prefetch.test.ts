import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// NAV-03: every nav link in all four renderers (desktop AND mobile, legacy AND domains) is an
// IntentLink -- prefetch on hover/touch/focus -- never a bare <Link prefetch>, which prefetched every
// route in the viewport and re-fired all of them after each write (~20 RSC GETs). Behaviour is pinned in
// the renderer tests and intent-link.test.tsx; this pins the wiring so a new nav link can't regress it.
const FILES = ["sidebar-nav.tsx", "mobile-island.tsx", "tab-sidebar-nav.tsx", "tab-mobile-island.tsx"];
const read = (f: string) => readFileSync(path.join(process.cwd(), "components/shell", f), "utf8");

describe("nav links prefetch on intent", () => {
  it.each(FILES)("%s: uses IntentLink and has no raw <Link> or prefetch prop", (file) => {
    const src = read(file);
    expect(src).toContain("<IntentLink");
    expect(src).not.toMatch(/<Link\b/);
    expect(src).not.toMatch(/^\s+prefetch\s*$/m);
    expect(src).not.toMatch(/\bprefetch=\{?true/);
  });

  it("positive control: the old shape would have been flagged", () => {
    expect('<Link href="/x"\n  prefetch\n>').toMatch(/<Link\b/);
    expect('<Link href="/x"\n  prefetch\n>').toMatch(/^\s+prefetch\s*$/m);
  });
});
