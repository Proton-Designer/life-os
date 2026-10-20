import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db";
import type { Db } from "../core";
import { classifyShare, createShareImportCore, SHARE_MAX_BYTES, SHARE_MAX_TEXT_CHARS } from "../share";

vi.mock("server-only", () => ({}));

const U = "11111111-1111-4111-8111-111111111111";
const none = { title: "", text: "", url: "", file: null };
const asDb = (d: FakeDb) => d as unknown as Db;

describe("classifyShare", () => {
  it("file beats link beats text; a URL in text counts as a link", () => {
    expect(classifyShare({ ...none, text: "t", url: "https://a.b/x", file: { name: "a.txt", bytes: new Uint8Array([1]) } })?.kind).toBe("file");
    expect(classifyShare({ ...none, text: "t", url: "https://a.b/x" })?.kind).toBe("url");
    expect(classifyShare({ ...none, text: "https://a.b/x" })).toEqual({ kind: "url", url: "https://a.b/x" });
    expect(classifyShare({ ...none, text: "Some words to read." })?.kind).toBe("paste");
  });
  it("nothing shared is null (positive control: whitespace-only text too)", () => {
    expect(classifyShare(none)).toBeNull();
    expect(classifyShare({ ...none, text: "  \n " })).toBeNull();
  });
});

describe("createShareImportCore", () => {
  it("shared text becomes a prepared reader import owned by the user", async () => {
    const db = new FakeDb();
    const text = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const r = await createShareImportCore(asDb(db), U, { ...none, title: "Shared piece", text });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const book = db.tables.books.find((b) => b.id === r.bookId)!;
    expect(book).toMatchObject({ user_id: U, reader_status: "ready", reader_source: "paste" });
    expect(db.objects.has(`${U}/${r.bookId}/reader-v1.json`)).toBe(true);
  });
  it("shared text over the cap is cut and flagged; text at the cap is not (positive control)", async () => {
    const sentence = "One more sentence goes right here. ";
    const long = sentence.repeat(Math.ceil((SHARE_MAX_TEXT_CHARS + 10) / sentence.length));
    expect(classifyShare({ ...none, text: long })).toMatchObject({ kind: "paste", truncated: true });
    expect(classifyShare({ ...none, text: long.slice(0, SHARE_MAX_TEXT_CHARS) })).toMatchObject({ kind: "paste", truncated: false });
    const r = await createShareImportCore(asDb(new FakeDb()), U, { ...none, text: long });
    expect(r).toMatchObject({ ok: true, truncated: true });
  });
  it("a shared text file is uploaded and prepared", async () => {
    const db = new FakeDb();
    const bytes = new TextEncoder().encode("A short file. ".repeat(60));
    const r = await createShareImportCore(asDb(db), U, { ...none, file: { name: "note.txt", bytes } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(db.objects.has(`${U}/${r.bookId}/source.txt`)).toBe(true);
  });
  it("positive control: nothing shared creates no book", async () => {
    const db = new FakeDb();
    const r = await createShareImportCore(asDb(db), U, none);
    expect(r).toMatchObject({ ok: false });
    expect(db.tables.books ?? []).toHaveLength(0);
  });
  it("an oversized file is refused before anything is created", async () => {
    const db = new FakeDb();
    const r = await createShareImportCore(asDb(db), U, { ...none, file: { name: "big.txt", bytes: new Uint8Array(SHARE_MAX_BYTES + 1) } });
    expect(r).toMatchObject({ ok: false });
    expect(db.tables.books ?? []).toHaveLength(0);
  });
  it("a prepare failure cleans the half-made import up", async () => {
    const db = new FakeDb();
    // A "pdf" that is not a PDF: prepare fails, and the import must not linger.
    const r = await createShareImportCore(asDb(db), U, { ...none, file: { name: "x.pdf", bytes: new TextEncoder().encode("not a pdf") } });
    expect(r.ok).toBe(false);
    expect(db.tables.books ?? []).toHaveLength(0);
  });
});
