// Reader import pipeline (pure: bytes/text/url in, ReaderDoc out). No DB or Storage access: lib/reader actions wire it.
import { BOOK_MAX_BYTES } from "@/lib/self-mastery/book-upload-limits";
import { tokenizeBlock } from "../tokenize";
import type { ReaderDoc, ReaderImportPreview, ReaderSource } from "../types";
import { buildReaderDoc } from "./build-doc";
import { markdownToBlocks, normalizeInline, textToBlocks, type RawBlock } from "./cleanup";
import { importEpub } from "./epub";
import { ReaderImportError, toReaderImportError } from "./errors";
import { htmlFileToBlocks, extractArticle } from "./html";
import { importPdf } from "./pdf";
import { fetchUrl, URL_MAX_BYTES } from "./url";

export { ReaderImportError } from "./errors";
export { isBlockedAddress, fetchUrl } from "./url";

export interface ImportResult {
  doc: ReaderDoc;
  warnings: string[];
}

export type ImportKind = "pdf" | "epub" | "txt" | "md" | "html";

export interface FileInput {
  bytes: Uint8Array;
  filename: string;
  title?: string | null;
  author?: string | null;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** Decide the format from content first, extension second (a renamed file still imports). */
export function detectKind(bytes: Uint8Array, filename: string): ImportKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return ext === "epub" || ext === "zip" || ext === "" ? "epub" : null; // zip
  if (["md", "markdown", "mdown"].includes(ext)) return "md";
  if (["html", "htm", "xhtml"].includes(ext)) return "html";
  if (["txt", "text", ""].includes(ext)) return "txt";
  // sniff: looks like HTML?
  const head = decodeText(bytes.subarray(0, 2048)).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "html";
  return null;
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function stem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return normalizeInline(base.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ")) || "Untitled";
}

function finish(args: {
  title: string | null | undefined;
  metaTitle?: string | null;
  fallbackTitle: string;
  author?: string | null;
  source: ReaderSource;
  sourceUrl?: string | null;
  blocks: RawBlock[];
  chapterStarts?: { title: string; blockIndex: number }[];
  warnings?: string[];
}): ImportResult {
  const title = normalizeInline(args.title || args.metaTitle || args.fallbackTitle) || "Untitled";
  const doc = buildReaderDoc({
    title,
    author: args.author,
    source: args.source,
    sourceUrl: args.sourceUrl ?? null,
    blocks: args.blocks,
    chapterStarts: args.chapterStarts,
  });
  return { doc, warnings: args.warnings ?? [] };
}

export async function importFile(input: FileInput): Promise<ImportResult> {
  try {
    if (input.bytes.length === 0) throw new ReaderImportError("empty", "That file is empty.");
    if (input.bytes.length > BOOK_MAX_BYTES) throw new ReaderImportError("too_large", "That file is too large. Imports can be up to 50 MB.");
    const kind = detectKind(input.bytes, input.filename);
    if (!kind) throw new ReaderImportError("unsupported_type");
    const fallbackTitle = stem(input.filename);

    if (kind === "pdf") {
      const r = await importPdf(input.bytes);
      return finish({ title: input.title, metaTitle: r.title, fallbackTitle, author: input.author ?? r.author, source: "pdf", blocks: r.blocks, chapterStarts: r.chapterStarts, warnings: r.warnings });
    }
    if (kind === "epub") {
      const r = importEpub(input.bytes);
      return finish({ title: input.title, metaTitle: r.title, fallbackTitle, author: input.author ?? r.author, source: "epub", blocks: r.blocks, chapterStarts: r.chapterStarts });
    }
    const text = decodeText(input.bytes);
    if (kind === "md") {
      const { blocks, headingLevels } = markdownToBlocks(text);
      const levels = headingLevels.filter((l) => l > 0);
      const maxLevel = levels.length && levels.some((l) => l <= 2) ? 2 : 6;
      const starts = blocks
        .map((b, i) => ({ b, i, l: headingLevels[i] }))
        .filter(({ b, l }) => b.kind === "h" && l <= maxLevel)
        .map(({ b, i }) => ({ title: b.text, blockIndex: i }));
      const firstH1 = blocks.find((b, i) => b.kind === "h" && headingLevels[i] === 1)?.text ?? null;
      return finish({ title: input.title, metaTitle: firstH1, fallbackTitle, author: input.author, source: "text", blocks, chapterStarts: starts });
    }
    if (kind === "html") {
      const r = htmlFileToBlocks(text);
      return finish({ title: input.title, metaTitle: r.title, fallbackTitle, author: input.author ?? r.author, source: "text", blocks: r.blocks });
    }
    return finish({ title: input.title, fallbackTitle, author: input.author, source: "text", blocks: textToBlocks(text) });
  } catch (err) {
    throw toReaderImportError(err);
  }
}

export function importPaste(text: string, opts: { title?: string | null; author?: string | null } = {}): ImportResult {
  try {
    if (!text || !text.trim()) throw new ReaderImportError("empty", "Paste some text to read first.");
    const blocks = textToBlocks(text);
    const firstWords = blocks[0] ? tokenizeBlock(blocks[0].text).slice(0, 8).join(" ") : "";
    return finish({ title: opts.title, fallbackTitle: firstWords ? `${firstWords}…` : "Pasted text", author: opts.author, source: "paste", blocks });
  } catch (err) {
    throw toReaderImportError(err);
  }
}

export async function importUrl(url: string, opts: { title?: string | null; author?: string | null; fetchImpl?: typeof fetchUrl } = {}): Promise<ImportResult> {
  try {
    const fetched = await (opts.fetchImpl ?? fetchUrl)(url);
    const ct = fetched.contentType.toLowerCase();
    const host = new URL(fetched.finalUrl).hostname;
    if (ct.includes("application/pdf") || startsWith(fetched.bytes, [0x25, 0x50, 0x44, 0x46])) {
      const r = await importPdf(fetched.bytes);
      return finish({ title: opts.title, metaTitle: r.title, fallbackTitle: host, author: opts.author ?? r.author, source: "url", sourceUrl: fetched.finalUrl, blocks: r.blocks, chapterStarts: r.chapterStarts, warnings: r.warnings });
    }
    if (ct.startsWith("text/plain")) {
      return finish({ title: opts.title, fallbackTitle: host, author: opts.author, source: "url", sourceUrl: fetched.finalUrl, blocks: textToBlocks(decodeText(fetched.bytes)) });
    }
    if (ct && !/html|xml/.test(ct)) throw new ReaderImportError("unsupported_type", "That link isn't a web page or PDF.");
    if (fetched.bytes.length > URL_MAX_BYTES) throw new ReaderImportError("too_large");
    const r = extractArticle(decodeText(fetched.bytes), fetched.finalUrl);
    return finish({ title: opts.title, metaTitle: r.title, fallbackTitle: host, author: opts.author ?? r.author, source: "url", sourceUrl: fetched.finalUrl, blocks: r.blocks });
  } catch (err) {
    throw toReaderImportError(err, "fetch_failed");
  }
}

/** First ~N words of the document as a preview sample. */
export function sampleOf(doc: ReaderDoc, words = 150): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    for (const w of tokenizeBlock(b.text)) {
      out.push(w);
      if (out.length >= words) return out.join(" ") + " …";
    }
  }
  return out.join(" ");
}

export function makePreview(bookId: string, result: ImportResult): ReaderImportPreview {
  const { doc, warnings } = result;
  return {
    bookId,
    title: doc.title,
    author: doc.author,
    source: doc.source,
    wordCount: doc.wordCount,
    chapters: doc.chapters.map((c) => ({ title: c.title, firstWord: c.firstWord })),
    sample: sampleOf(doc),
    warnings,
  };
}
