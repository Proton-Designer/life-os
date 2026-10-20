// Storage layout for a book's reader files, inside the private `books` bucket. The first path
// segment is the owner's uid (storage policy 083 keys on it). Paths are always recomputed on the
// server from the authenticated uid + a validated book id; a client-supplied path is never trusted.

export const BOOKS_BUCKET = "books";

export function readerFolder(userId: string, bookId: string): string {
  return `${userId}/${bookId}`;
}

export function readerDocPath(userId: string, bookId: string): string {
  return `${readerFolder(userId, bookId)}/reader-v1.json`;
}

/** Allowed upload extensions -> stored extension. Everything else is refused before a URL is minted. */
const SOURCE_EXTENSIONS: Record<string, string> = {
  pdf: "pdf",
  epub: "epub",
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  mdown: "md",
  html: "html",
  htm: "html",
  xhtml: "html",
};

export function sourceExtension(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return SOURCE_EXTENSIONS[ext] ?? null;
}

export function readerSourcePath(userId: string, bookId: string, ext: string): string {
  return `${readerFolder(userId, bookId)}/source.${ext}`;
}

/** The ReaderSource stored in books.reader_source for an upload of this stored extension. */
export function sourceKindForExtension(ext: string): "pdf" | "epub" | "text" {
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  return "text";
}

/**
 * Content type the client must send when uploading a source of this stored extension. Browsers report "" for
 * .md/.epub, and the `books` bucket only accepts the types listed in migration 269, so the server names the type.
 */
export function mimeForExtension(ext: string): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "epub":
      return "application/epub+zip";
    case "md":
      return "text/markdown";
    case "html":
      return "text/html";
    default:
      return "text/plain";
  }
}
