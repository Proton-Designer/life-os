import { zipSync, strToU8 } from "fflate";

/** Build a minimal valid EPUB in memory. */
export function makeEpub(opts: {
  title?: string;
  author?: string;
  chapters: { file: string; html: string; tocTitle?: string; tocFragment?: string }[];
  toc?: "nav" | "ncx" | "none";
  encryptionXml?: string;
}): Uint8Array {
  const toc = opts.toc ?? "nav";
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ),
  };
  const items = opts.chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("");
  const refs = opts.chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  const navItem = toc === "nav" ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` : "";
  const ncxItem = toc === "ncx" ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>` : "";
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${opts.title ?? "Test Book"}</dc:title><dc:creator>${opts.author ?? "A. Writer"}</dc:creator></metadata><manifest>${items}${navItem}${ncxItem}</manifest><spine${toc === "ncx" ? ' toc="ncx"' : ""}>${refs}</spine></package>`
  );
  for (const c of opts.chapters) files[`OEBPS/${c.file}`] = strToU8(c.html);
  const tocEntries = opts.chapters.filter((c) => c.tocTitle);
  if (toc === "nav") {
    files["OEBPS/nav.xhtml"] = strToU8(
      `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${tocEntries
        .map((c) => `<li><a href="${c.file}${c.tocFragment ? "#" + c.tocFragment : ""}">${c.tocTitle}</a></li>`)
        .join("")}</ol></nav></body></html>`
    );
  } else if (toc === "ncx") {
    files["OEBPS/toc.ncx"] = strToU8(
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${tocEntries
        .map((c, i) => `<navPoint id="n${i}"><navLabel><text>${c.tocTitle}</text></navLabel><content src="${c.file}${c.tocFragment ? "#" + c.tocFragment : ""}"/></navPoint>`)
        .join("")}</navMap></ncx>`
    );
  }
  if (opts.encryptionXml) files["META-INF/encryption.xml"] = strToU8(opts.encryptionXml);
  return zipSync(files);
}

export interface PdfPageSpec {
  lines: string[];
}

/** Hand-rolled text PDF (Helvetica). `outline` entries point at 1-based pages. */
export function makePdf(pages: PdfPageSpec[], outline: { title: string; page: number }[] = [], meta: { title?: string; author?: string } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => {
    objs.push(body);
    return objs.length; // 1-based object number
  };
  const catalog = add(""); // 1 placeholder
  const pagesObj = add(""); // 2 placeholder
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pageNums: number[] = [];
  for (const p of pages) {
    const stream = p.lines.length ? `BT /F1 11 Tf 14 TL 50 740 Td ${p.lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET` : "";
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageNums.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  let outlinesRef = "";
  if (outline.length) {
    const root = add("");
    const items = outline.map(() => add(""));
    outline.forEach((o, i) => {
      objs[items[i] - 1] = `<< /Title (${esc(o.title)}) /Parent ${root} 0 R /Dest [${pageNums[o.page - 1]} 0 R /Fit]${i > 0 ? ` /Prev ${items[i - 1]} 0 R` : ""}${i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : ""} >>`;
    });
    objs[root - 1] = `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`;
    outlinesRef = ` /Outlines ${root} 0 R`;
  }
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlinesRef} >>`;
  let info = "";
  if (meta.title || meta.author) {
    const n = add(`<< ${meta.title ? `/Title (${esc(meta.title)})` : ""} ${meta.author ? `/Author (${esc(meta.author)})` : ""} >>`);
    info = ` /Info ${n} 0 R`;
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((b, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info} >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(out);
}

export const LOREM = [
  "The quick brown fox jumps over the lazy dog while the sun sets slowly behind the distant hills,",
  "and every creature in the valley settles down for the long quiet night that is coming soon after.",
];
