import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { tokenizeBlock } from "../tokenize";
import { normalizeInline, type RawBlock } from "./cleanup";
import { ReaderImportError } from "./errors";

// Minimal structural typing so this file doesn't depend on lib.dom.
interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?(name: string): string | null;
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV", "ASIDE", "FORM", "BUTTON", "SVG", "IFRAME", "HEAD", "AUDIO", "VIDEO", "CANVAS", "SELECT"]);
const HEADING = /^H[1-6]$/;
const LEAF = new Set(["P", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION", "DT", "DD", "TD", "TH", "SUMMARY", "CAPTION"]);
const CONTAINER = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "BODY", "UL", "OL", "DL", "TABLE", "TBODY", "THEAD", "TR", "FIGURE", "DETAILS", "FOOTER", "HEADER", "FIELDSET", "HGROUP", "CENTER"]);

function hasBlockDescendant(node: DomNode): boolean {
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType !== 1) continue;
    const n = c.nodeName.toUpperCase();
    if (HEADING.test(n) || LEAF.has(n) || CONTAINER.has(n)) return true;
    if (!SKIP.has(n) && hasBlockDescendant(c)) return true;
  }
  return false;
}

export interface HtmlBlocks {
  blocks: RawBlock[];
  /** element id -> index of the first block emitted at/after that element (for EPUB fragment TOC links). */
  idToBlock: Map<string, number>;
}

/** Walk a DOM subtree into paragraph/heading blocks. Inline-only runs between block children become paragraphs. */
export function htmlToBlocks(root: DomNode): HtmlBlocks {
  const blocks: RawBlock[] = [];
  const idToBlock = new Map<string, number>();
  let run = "";

  const flushRun = () => {
    const t = normalizeInline(run);
    if (t) blocks.push({ kind: "p", text: t });
    run = "";
  };
  const noteId = (n: DomNode) => {
    const id = n.getAttribute?.("id");
    if (id && !idToBlock.has(id)) idToBlock.set(id, blocks.length + (run.trim() ? 1 : 0));
  };
  const walk = (node: DomNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        run += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const name = child.nodeName.toUpperCase();
      if (SKIP.has(name)) continue;
      noteId(child);
      if (name === "BR") {
        run += " ";
        continue;
      }
      if (HEADING.test(name)) {
        flushRun();
        const t = normalizeInline(child.textContent ?? "");
        if (t) blocks.push({ kind: "h", text: t });
        continue;
      }
      if (LEAF.has(name) && !hasBlockDescendant(child)) {
        flushRun();
        const t = normalizeInline(child.textContent ?? "");
        if (t) blocks.push({ kind: "p", text: t });
        continue;
      }
      if (LEAF.has(name) || CONTAINER.has(name)) {
        flushRun();
        walk(child);
        flushRun();
        continue;
      }
      // inline element (a, span, em, ...): keep its text in the current run, but still honour nested blocks.
      if (hasBlockDescendant(child)) {
        flushRun();
        walk(child);
        flushRun();
      } else {
        run += child.textContent ?? "";
      }
    }
  };
  walk(root);
  flushRun();
  return { blocks, idToBlock };
}

export function parseHtmlDocument(html: string): { document: ReturnType<typeof parseHTML>["document"] } {
  return parseHTML(html);
}

/** Fewer words than this and Readability has probably grabbed a stub, not an article. */
const MIN_ARTICLE_WORDS = 40;

export interface ArticleResult {
  title: string | null;
  author: string | null;
  blocks: RawBlock[];
}

/** HTML page -> main article blocks (Mozilla Readability). */
export function extractArticle(html: string, url?: string): ArticleResult {
  if (!html || !html.trim()) throw new ReaderImportError("empty");
  let parsed: ArticleResult | null = null;
  try {
    const { document } = parseHTML(html);
    if (url) {
      try {
        // Readability resolves relative links against documentURI; harmless if the DOM won't take it.
        Object.defineProperty(document, "documentURI", { value: url, configurable: true });
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const article = new Readability(document as any, { charThreshold: 200 }).parse();
    if (article && article.content) {
      const { document: contentDoc } = parseHTML(`<html><body>${article.content}</body></html>`);
      const { blocks } = htmlToBlocks(contentDoc.body as unknown as DomNode);
      parsed = { title: article.title?.trim() || null, author: article.byline?.trim() || null, blocks };
    }
  } catch (err) {
    throw new ReaderImportError("parse_failed", undefined, { cause: err });
  }
  const words = parsed ? parsed.blocks.reduce((n, b) => n + tokenizeBlock(b.text).length, 0) : 0;
  if (!parsed || words < MIN_ARTICLE_WORDS) throw new ReaderImportError("not_article");
  return parsed;
}

/** A standalone .html/.htm file: prefer the article extraction, fall back to the whole body. */
export function htmlFileToBlocks(html: string, url?: string): ArticleResult {
  try {
    return extractArticle(html, url);
  } catch (err) {
    if (!(err instanceof ReaderImportError) || err.code !== "not_article") throw err;
  }
  try {
    const { document } = parseHTML(html);
    const { blocks } = htmlToBlocks(document.body as unknown as DomNode);
    if (blocks.length === 0) throw new ReaderImportError("empty");
    const title = normalizeInline(document.title ?? "") || null;
    return { title, author: null, blocks };
  } catch (err) {
    if (err instanceof ReaderImportError) throw err;
    throw new ReaderImportError("parse_failed", undefined, { cause: err });
  }
}
