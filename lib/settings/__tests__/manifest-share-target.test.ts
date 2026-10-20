import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(__dirname, "../../../public/manifest.json"), "utf8"));

// The reader's /read/import landing (app/(app)/read/import/page.tsx) reads exactly title, text and url.
describe("PWA manifest share target", () => {
  it("shares by multipart POST (long text stays out of the URL) to the route that creates the import", () => {
    const st = manifest.share_target;
    expect(st).toMatchObject({ action: "/api/reader/share", method: "POST", enctype: "multipart/form-data" });
    expect(st.params).toMatchObject({ title: "title", text: "text", url: "url" });
    expect(st.params.files[0].name).toBe("files");
  });

  it("the route reads exactly the fields the manifest declares (positive control: it would miss a renamed one)", () => {
    const route = readFileSync(join(__dirname, "../../../app/api/reader/share/route.ts"), "utf8");
    for (const key of ["title", "text", "url"]) expect(route).toContain(`str("${key}")`);
    expect(route).toContain('getAll("files")');
    expect(route).not.toContain('str("nonexistent")');
  });

  it("the landing page still reads the old GET params (installs that cached the old manifest keep working) and ?pending", () => {
    const page = readFileSync(join(__dirname, "../../../app/(app)/read/import/page.tsx"), "utf8");
    for (const key of ["title", "text", "url", "pending", "error"]) expect(page).toContain(`sp.${key}`);
    expect(page).not.toContain("sp.nonexistent");
  });

  it("keeps the existing Capture shortcut and adds Import to read", () => {
    const names = manifest.shortcuts.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Capture", "Import to read"]);
  });
});
