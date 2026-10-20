import { describe, expect, it } from "vitest";
import { extractArticle, htmlFileToBlocks, htmlToBlocks } from "../html";
import { parseHTML } from "linkedom";
import { ReaderImportError } from "../errors";

const para = (n: number) => `<p>Paragraph ${n}: ${"This sentence carries real article content for the extractor to keep. ".repeat(6)}</p>`;
const page = `<!doctype html><html><head><title>How Focus Works - Example</title></head><body>
<header><nav><a href="/">Home</a><a href="/x">About</a></nav></header>
<article><h1>How Focus Works</h1><p class="byline">By Sam Writer</p>${para(1)}${para(2)}<h2>Second half</h2>${para(3)}${para(4)}</article>
<aside>Subscribe to our newsletter now</aside><footer>Copyright junk</footer><script>var x = 1;</script></body></html>`;

describe("extractArticle", () => {
  it("returns the article body without nav/aside/footer/script", () => {
    const r = extractArticle(page, "https://example.com/post");
    const text = r.blocks.map((b) => b.text).join("\n");
    expect(text).toContain("Paragraph 3");
    expect(text).not.toMatch(/newsletter|Copyright|var x/);
    expect(r.blocks.some((b) => b.kind === "h" && b.text === "Second half")).toBe(true);
    expect(r.title).toMatch(/How Focus Works/);
  });
  it("not_article for a page with no real content; empty for blank", () => {
    expect(() => extractArticle("<html><body><p>hi</p></body></html>")).toThrowError(ReaderImportError);
    try {
      extractArticle("   ");
    } catch (e) {
      expect((e as ReaderImportError).code).toBe("empty");
    }
  });
});

describe("htmlFileToBlocks", () => {
  it("falls back to the whole body when Readability finds no article", () => {
    const r = htmlFileToBlocks("<html><head><title>Short</title></head><body><h1>Note</h1><p>A tiny page.</p></body></html>");
    expect(r.blocks.map((b) => b.text)).toEqual(["Note", "A tiny page."]);
    expect(r.title).toBe("Short");
  });
});

describe("htmlToBlocks", () => {
  it("handles inline runs between blocks, br, nested lists and records ids", () => {
    const { document } = parseHTML(`<html><body><div>loose <b>bold</b> text<br>after br<p id="p1">Para <a href="#">link</a></p><ul><li>one</li><li>two <em>x</em></li></ul></div></body></html>`);
    const { blocks, idToBlock } = htmlToBlocks(document.body as never);
    expect(blocks.map((b) => b.text)).toEqual(["loose bold text after br", "Para link", "one", "two x"]);
    expect(idToBlock.get("p1")).toBe(1);
  });
});
