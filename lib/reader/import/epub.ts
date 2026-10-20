import { unzipSync, strFromU8 } from "fflate";
import { parseHTML, DOMParser } from "linkedom";
import { htmlToBlocks, type HtmlBlocks } from "./html";
import { normalizeInline, type RawBlock } from "./cleanup";
import { ReaderImportError } from "./errors";

const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
const TEXTY = /\.(x?html?|opf|ncx|xml)$/i;
// Algorithms that only obfuscate embedded fonts; anything else in encryption.xml means DRM'd content.
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

export interface EpubResult {
  title: string | null;
  author: string | null;
  blocks: RawBlock[];
  chapterStarts: { title: string; blockIndex: number }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = any;

function xml(src: string): XmlNode {
  return new DOMParser().parseFromString(src.replace(/^﻿/, ""), "text/xml");
}

/** Resolve `href` against the directory of `baseFile` inside the zip (no leading slash, no ../ left over). */
export function resolveZipPath(baseFile: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  const baseDir = baseFile.includes("/") ? baseFile.slice(0, baseFile.lastIndexOf("/") + 1) : "";
  const parts = (clean.startsWith("/") ? clean.slice(1) : baseDir + clean).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function textOf(el: XmlNode | null | undefined): string {
  return normalizeInline(el?.textContent ?? "");
}

function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (file.originalSize > MAX_ENTRY_BYTES) throw new ReaderImportError("too_large", "This EPUB contains a file that is too large.");
        if (!TEXTY.test(file.name) && file.name !== "mimetype") return false;
        total += file.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new ReaderImportError("too_large", "This EPUB is too large once unpacked.");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ReaderImportError) throw err;
    throw new ReaderImportError("parse_failed", "That doesn't look like a valid EPUB.", { cause: err });
  }
}

export function importEpub(bytes: Uint8Array): EpubResult {
  const files = readZip(bytes);
  const get = (path: string): Uint8Array | undefined => files[path] ?? files[Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase()) ?? ""];

  const enc = get("META-INF/encryption.xml");
  if (enc) {
    const encText = strFromU8(enc);
    const algs = Array.from(encText.matchAll(/Algorithm\s*=\s*"([^"]+)"/g)).map((m) => m[1]);
    if (algs.some((a) => !FONT_OBFUSCATION.includes(a))) {
      throw new ReaderImportError("parse_failed", "This EPUB is DRM-protected, so it can't be read here.");
    }
  }

  const container = get("META-INF/container.xml");
  if (!container) throw new ReaderImportError("parse_failed", "That doesn't look like a valid EPUB (no container.xml).");
  const rootfile = xml(strFromU8(container)).querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  const opfBytes = opfPath ? get(opfPath) : undefined;
  if (!opfPath || !opfBytes) throw new ReaderImportError("parse_failed", "That EPUB has no package file.");
  const opf = xml(strFromU8(opfBytes));

  const title = textOf(opf.getElementsByTagName("dc:title")[0]) || null;
  const author = textOf(opf.getElementsByTagName("dc:creator")[0]) || null;

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of Array.from(opf.getElementsByTagName("item") as ArrayLike<XmlNode>)) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, { href: resolveZipPath(opfPath, href), type: item.getAttribute("media-type") ?? "", props: item.getAttribute("properties") ?? "" });
  }
  const spineEl = opf.getElementsByTagName("spine")[0];
  const spine: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName("itemref") as ArrayLike<XmlNode>)) {
    const m = manifest.get(ref.getAttribute("idref") ?? "");
    if (m) spine.push(m.href);
  }
  if (spine.length === 0) throw new ReaderImportError("parse_failed", "That EPUB has no readable content.");

  // ── table of contents: EPUB3 nav, else NCX ──
  const tocEntries: { title: string; file: string; fragment: string | null }[] = [];
  const addToc = (label: string, tocFile: string, href: string | null) => {
    if (!href || !label) return;
    const [, frag] = href.split("#");
    tocEntries.push({ title: label, file: resolveZipPath(tocFile, href), fragment: frag ? decodeURIComponent(frag) : null });
  };
  let navPath: string | null = null;
  for (const m of manifest.values()) if (m.props.split(/\s+/).includes("nav")) navPath = m.href;
  const navBytes = navPath ? get(navPath) : undefined;
  if (navPath && navBytes) {
    const { document } = parseHTML(strFromU8(navBytes));
    const navs = Array.from(document.querySelectorAll("nav") as ArrayLike<XmlNode>);
    const toc = navs.find((n) => /toc/.test(n.getAttribute("epub:type") ?? n.getAttribute("type") ?? "")) ?? navs[0];
    for (const a of Array.from(toc?.querySelectorAll("a") ?? []) as XmlNode[]) addToc(textOf(a), navPath, a.getAttribute("href"));
  }
  if (tocEntries.length === 0) {
    const ncxId = spineEl?.getAttribute("toc");
    const ncxItem = ncxId ? manifest.get(ncxId) : [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
    const ncxBytes = ncxItem ? get(ncxItem.href) : undefined;
    if (ncxItem && ncxBytes) {
      const ncx = xml(strFromU8(ncxBytes));
      for (const np of Array.from(ncx.getElementsByTagName("navPoint") as ArrayLike<XmlNode>)) {
        const label = textOf(np.getElementsByTagName("text")[0]);
        const src = np.getElementsByTagName("content")[0]?.getAttribute("src") ?? null;
        addToc(label, ncxItem.href, src);
      }
    }
  }

  // ── content ──
  const blocks: RawBlock[] = [];
  const fileStart = new Map<string, number>();
  const fragStart = new Map<string, number>(); // `${file}#${id}` -> block index
  for (const file of spine) {
    if (file === navPath) continue;
    const m = [...manifest.values()].find((x) => x.href === file);
    if (m && m.type && !/html|xml/i.test(m.type)) continue;
    const raw = get(file);
    if (!raw) continue;
    let part: HtmlBlocks;
    try {
      const { document } = parseHTML(strFromU8(raw));
      part = htmlToBlocks(document.body ?? document.documentElement);
    } catch {
      continue; // one bad chapter shouldn't sink the book
    }
    fileStart.set(file, blocks.length);
    for (const [id, idx] of part.idToBlock) fragStart.set(`${file}#${id}`, blocks.length + idx);
    blocks.push(...part.blocks);
  }
  if (blocks.length === 0) throw new ReaderImportError("empty", "That EPUB has no readable text.");

  const chapterStarts: { title: string; blockIndex: number }[] = [];
  for (const t of tocEntries) {
    const idx = (t.fragment ? fragStart.get(`${t.file}#${t.fragment}`) : undefined) ?? fileStart.get(t.file);
    if (idx !== undefined) chapterStarts.push({ title: t.title, blockIndex: idx });
  }
  return { title, author, blocks, chapterStarts };
}
