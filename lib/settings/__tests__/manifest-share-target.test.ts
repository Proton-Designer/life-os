import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(__dirname, "../../../public/manifest.json"), "utf8"));

// The reader's /read/import landing (app/(app)/read/import/page.tsx) reads exactly title, text and url.
describe("PWA manifest share target", () => {
  it("shares to the reader import landing over GET with the three params it reads", () => {
    expect(manifest.share_target).toEqual({ action: "/read/import", method: "GET", params: { title: "title", text: "text", url: "url" } });
  });

  it("the landing page reads those same query params (positive control: the check is not vacuous)", () => {
    const page = readFileSync(join(__dirname, "../../../app/(app)/read/import/page.tsx"), "utf8");
    for (const key of Object.keys(manifest.share_target.params)) expect(page).toContain(`sp.${key}`);
    expect(page).not.toContain("sp.nonexistent");
  });

  it("keeps the existing Capture shortcut and adds Import to read", () => {
    const names = manifest.shortcuts.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Capture", "Import to read"]);
  });
});
