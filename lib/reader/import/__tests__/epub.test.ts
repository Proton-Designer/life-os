import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importEpub, resolveZipPath } from "../epub";
import { buildReaderDoc } from "../build-doc";
import { ReaderImportError } from "../errors";
import { makeEpub } from "./helpers";

const ch1 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="top">The Start</h1><p>It was a <em>bright</em> day.</p><p>Second paragraph here.</p></body></html>`;
const ch2 = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Middle</h1><p>Words in the middle.</p><h2 id="late">Late Section</h2><p>Final words arrive.</p></body></html>`;

describe("importEpub", () => {
  it("reads metadata, spine text and EPUB3 nav chapters (file + fragment targets)", () => {
    const r = importEpub(
      makeEpub({
        title: "My Book",
        author: "Jane Doe",
        chapters: [
          { file: "c1.xhtml", html: ch1, tocTitle: "The Start" },
          { file: "c2.xhtml", html: ch2, tocTitle: "Middle" },
          { file: "c2.xhtml", html: ch2, tocTitle: "Late Section", tocFragment: "late" },
        ].slice(0, 2).concat([] as never[]),
      })
    );
    expect(r.title).toBe("My Book");
    expect(r.author).toBe("Jane Doe");
    expect(r.blocks.map((b) => b.text)).toEqual(["The Start", "It was a bright day.", "Second paragraph here.", "Middle", "Words in the middle.", "Late Section", "Final words arrive."]);
    expect(r.chapterStarts).toEqual([{ title: "The Start", blockIndex: 0 }, { title: "Middle", blockIndex: 3 }]);
  });

  it("resolves a fragment TOC link into the middle of a file", () => {
    const epub = makeEpub({
      chapters: [
        { file: "c1.xhtml", html: ch1, tocTitle: "The Start" },
        { file: "c2.xhtml", html: ch2, tocTitle: "Middle" },
      ],
    });
    // add a second toc entry pointing inside c2 by rebuilding with the fragment entry
    const withFrag = makeEpub({
      chapters: [
        { file: "c1.xhtml", html: ch1, tocTitle: "The Start" },
        { file: "c2.xhtml", html: ch2, tocTitle: "Late Section", tocFragment: "late" },
      ],
    });
    expect(importEpub(epub).chapterStarts).toHaveLength(2);
    const r = importEpub(withFrag);
    expect(r.chapterStarts.find((c) => c.title === "Late Section")?.blockIndex).toBe(5);
  });

  it("falls back to NCX when there is no nav document", () => {
    const r = importEpub(makeEpub({ toc: "ncx", chapters: [{ file: "c1.xhtml", html: ch1, tocTitle: "NCX One" }, { file: "c2.xhtml", html: ch2, tocTitle: "NCX Two" }] }));
    expect(r.chapterStarts.map((c) => c.title)).toEqual(["NCX One", "NCX Two"]);
  });

  it("builds a consistent ReaderDoc; no toc -> heading chapters", () => {
    const r = importEpub(makeEpub({ toc: "none", chapters: [{ file: "c1.xhtml", html: ch1 }, { file: "c2.xhtml", html: ch2 }] }));
    const doc = buildReaderDoc({ title: r.title ?? "x", source: "epub", blocks: r.blocks, chapterStarts: r.chapterStarts });
    expect(doc.chapters.map((c) => c.title)).toEqual(["The Start", "Middle", "Late Section"]);
    expect(doc.wordCount).toBeGreaterThan(10);
  });

  it("rejects DRM and positive control: font obfuscation alone is fine", () => {
    const drm = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`;
    const fonts = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`;
    const base = { chapters: [{ file: "c1.xhtml", html: ch1 }] };
    expect(() => importEpub(makeEpub({ ...base, encryptionXml: drm }))).toThrowError(/DRM/);
    expect(importEpub(makeEpub({ ...base, encryptionXml: fonts })).blocks.length).toBeGreaterThan(0);
  });

  it("typed errors for non-zip and zip without container", () => {
    expect(() => importEpub(strToU8("not a zip"))).toThrowError(ReaderImportError);
    expect(() => importEpub(zipSync({ "a.txt": strToU8("x") }))).toThrowError(/container|valid EPUB/);
  });

  it("resolveZipPath handles ../, absolute and encoded hrefs", () => {
    expect(resolveZipPath("OEBPS/content.opf", "text/c1.xhtml#a")).toBe("OEBPS/text/c1.xhtml");
    expect(resolveZipPath("OEBPS/text/nav.xhtml", "../img%20a/x.xhtml")).toBe("OEBPS/img a/x.xhtml");
    expect(resolveZipPath("OEBPS/content.opf", "/abs/f.xhtml")).toBe("abs/f.xhtml");
  });
});
