import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { buildDocWords } from "../../doc-words";
import { detectKind, importFile, importPaste, importUrl, makePreview } from "../index";
import { ReaderImportError } from "../errors";
import { makeEpub, makePdf } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);

describe("importFile", () => {
  it("txt: paragraphs + title from filename + consistent word indexes", async () => {
    const r = await importFile({ bytes: enc("First paragraph here.\n\nSecond paragraph is longer than the first one.\n"), filename: "my_notes.txt" });
    expect(r.doc.title).toBe("my notes");
    expect(r.doc.source).toBe("text");
    expect(r.doc.wordCount).toBe(11);
    const dw = buildDocWords(r.doc);
    expect(dw.words).toHaveLength(r.doc.wordCount);
  });

  it("md: title from first H1, chapters from H1/H2 only", async () => {
    const r = await importFile({ bytes: enc("# My Doc\n\nintro words\n\n## One\n\nbody one\n\n### deep\n\nmore\n\n## Two\n\nbody two"), filename: "x.md" });
    expect(r.doc.title).toBe("My Doc");
    expect(r.doc.chapters.map((c) => c.title)).toEqual(["My Doc", "One", "Two"]);
  });

  it("epub and pdf dispatch by content, and a renamed extension still works", async () => {
    const epub = makeEpub({ title: "Epub T", chapters: [{ file: "c.xhtml", html: "<html><body><h1>Hi</h1><p>some words in a paragraph</p></body></html>", tocTitle: "Hi" }] });
    const e = await importFile({ bytes: epub, filename: "book.epub" });
    expect(e.doc.source).toBe("epub");
    expect(e.doc.title).toBe("Epub T");
    const pdf = makePdf([{ lines: ["A sentence with enough words in it to count as real text for this page."] }, { lines: ["Another sentence on the second page with plenty of real words too."] }]);
    const p = await importFile({ bytes: pdf, filename: "scan.bin" });
    expect(p.doc.source).toBe("pdf");
  });

  it("user-supplied title/author win over metadata", async () => {
    const r = await importFile({ bytes: enc("a b c"), filename: "z.txt", title: "Mine", author: "Me" });
    expect([r.doc.title, r.doc.author]).toEqual(["Mine", "Me"]);
  });

  it("typed errors: empty, too large, unsupported, scanned pdf, windows-1252 text still decodes", async () => {
    await expect(importFile({ bytes: new Uint8Array(), filename: "a.txt" })).rejects.toMatchObject({ code: "empty" });
    await expect(importFile({ bytes: enc("   \n\n  "), filename: "a.txt" })).rejects.toMatchObject({ code: "empty" });
    await expect(importFile({ bytes: new Uint8Array([1, 2, 3, 4]), filename: "a.exe" })).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(importFile({ bytes: makePdf([{ lines: [] }]), filename: "s.pdf" })).rejects.toMatchObject({ code: "no_text" });
    const cp = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x75, 0x69]); // "café oui"
    expect((await importFile({ bytes: cp, filename: "c.txt" })).doc.blocks[0].text).toBe("café oui");
  });

  it("never throws a raw error: garbage zip named .epub", async () => {
    await expect(importFile({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]), filename: "b.epub" })).rejects.toBeInstanceOf(ReaderImportError);
  });
});

describe("detectKind", () => {
  it("content beats extension; unknown stays null", () => {
    expect(detectKind(enc("%PDF-1.4"), "x.txt")).toBe("pdf");
    expect(detectKind(strToU8("<!doctype html><p>x"), "page")).toBe("html");
    expect(detectKind(enc("zzz"), "x.docx")).toBeNull();
  });
});

describe("importPaste / preview", () => {
  it("builds a doc, derives a title from the first words, and a preview with sample + chapters", () => {
    const r = importPaste("Alpha beta gamma delta.\n\nSecond paragraph.");
    expect(r.doc.source).toBe("paste");
    expect(r.doc.title).toBe("Alpha beta gamma delta.…");
    const prev = makePreview("book-1", r);
    expect(prev).toMatchObject({ bookId: "book-1", wordCount: 6, source: "paste" });
    expect(prev.sample).toBe("Alpha beta gamma delta. Second paragraph.");
    expect(prev.chapters).toHaveLength(1);
  });
  it("empty paste", () => {
    expect(() => importPaste("  \n ")).toThrowError(/Paste some text/);
  });
});

describe("importUrl", () => {
  const html = `<html><head><title>Great Post</title></head><body><article><h1>Great Post</h1>${"<p>" + "Real article sentence with enough words to be kept by the extractor. ".repeat(8) + "</p>".repeat(1)}${"<p>" + "Another paragraph full of words for the extractor to find here. ".repeat(8) + "</p>"}</article></body></html>`;
  const fakeFetch = (contentType: string, body: Uint8Array) => async () => ({ finalUrl: "https://blog.example.com/post", contentType, bytes: body });

  it("article url -> doc with sourceUrl; plain text and unsupported content types", async () => {
    const r = await importUrl("https://blog.example.com/post", { fetchImpl: fakeFetch("text/html", enc(html)) });
    expect(r.doc.source).toBe("url");
    expect(r.doc.sourceUrl).toBe("https://blog.example.com/post");
    expect(r.doc.wordCount).toBeGreaterThan(100);
    const t = await importUrl("https://x.example/a.txt", { fetchImpl: fakeFetch("text/plain", enc("plain words here")) });
    expect(t.doc.blocks[0].text).toBe("plain words here");
    await expect(importUrl("https://x.example/i.png", { fetchImpl: fakeFetch("image/png", enc("x")) })).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("a non-article page is not_article and fetch failures keep their typed code", async () => {
    await expect(importUrl("https://x.example", { fetchImpl: fakeFetch("text/html", enc("<html><body><p>hi</p></body></html>")) })).rejects.toMatchObject({ code: "not_article" });
    await expect(importUrl("http://127.0.0.1/x")).rejects.toMatchObject({ code: "fetch_failed" });
  });
});
