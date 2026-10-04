import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SEED_CLASSES, SEED_EMAIL, assertSeedEmail, buildDocx, buildPdf } from "../seed-e2e-legacy";

describe("seed-e2e-legacy", () => {
  it("refuses every account except the seed account", () => {
    expect(() => assertSeedEmail(SEED_EMAIL)).not.toThrow();
    for (const bad of ["ayman.m0704@gmail.com", "seed@lifeos.test", "SEED-legacy@lifeos.test", "", undefined, null]) {
      expect(() => assertSeedEmail(bad as string | undefined | null)).toThrow(/refusing/);
    }
  });

  it("seeds exactly the classes, order and syllabi the school specs read", () => {
    const spec = readFileSync("e2e/school-class-view.spec.ts", "utf8");
    const order = /const CLASS_ORDER = (\[[^\]]+\])/.exec(spec);
    expect(order, "CLASS_ORDER not found in the spec").not.toBeNull();
    expect(SEED_CLASSES.map((c) => c.shortName)).toEqual(JSON.parse(order![1]));
    expect(SEED_CLASSES.find((c) => c.shortName === "Lin Alg")!.code).toMatch(/MATH 2418/);
    expect(SEED_CLASSES.find((c) => c.shortName === "DSA")!.syllabus).toBe("pdf");
    expect(SEED_CLASSES.find((c) => c.shortName === "Ameri Studies")!.syllabus).toBe("docx");
    expect(new Set(SEED_CLASSES.map((c) => c.code)).size).toBe(SEED_CLASSES.length);
  });

  it("builds a PDF and a DOCX that are structurally valid", async () => {
    const pdf = buildPdf().toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");

    const zip = await JSZip.loadAsync(await buildDocx());
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]));
    expect(await zip.file("word/document.xml")!.async("string")).toContain("E2E fixture syllabus");
  });
});
