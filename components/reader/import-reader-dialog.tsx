"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, FileText, Link2, Loader2, Upload } from "lucide-react";
import { cancelReaderImport, confirmReaderImport, createReaderImport, prepareReaderDoc } from "@/app/(app)/personal/reader-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { BOOK_MAX_BYTES, BOOK_MAX_SIZE_MESSAGE } from "@/lib/self-mastery/book-upload-limits";
import { browserStorage, loadSettings } from "@/lib/reader/reader-storage";
import type { ReaderImportPreview } from "@/lib/reader/types";
import { cn } from "@/lib/utils";

// "books" is hardcoded for the same reason upload-book-dialog.tsx hardcodes it: the actions module is "use server"
// and can only export async functions.
const BOOKS_BUCKET = "books";
const UPLOAD_FAILED = "The upload didn't go through. Check your connection and try again.";
const ACCEPT = ".pdf,.epub,.txt,.text,.md,.markdown,.html,.htm,application/pdf,application/epub+zip,text/plain,text/markdown,text/html";

type Tab = "file" | "paste" | "link";
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "file", label: "File", icon: Upload },
  { id: "paste", label: "Paste", icon: FileText },
  { id: "link", label: "Link", icon: Link2 },
];

/** Reading-speed estimate shown in the preview ("about 40 min at 300 words per minute"). */
export function readingTimeLabel(words: number, wpm = 300): string {
  const mins = Math.max(1, Math.round(words / wpm));
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}

/**
 * Import something to read: a file (PDF, EPUB, text, Markdown, HTML), pasted text, or an article link. Never needs the
 * AI key or the ingestion worker. Shows what was found (title, length, chapters, a sample) before it joins the library.
 */
export function ImportReaderDialog({ trigger, initial, defaultOpen = false }: { trigger?: React.ReactNode; initial?: { tab?: Tab; text?: string; url?: string; title?: string }; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(initial?.text ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReaderImportPreview | null>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [author, setAuthor] = useState("");
  const [wpm, setWpm] = useState(300);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setText("");
    setUrl("");
    setError(null);
    setBookId(null);
    setPreview(null);
    setTitle("");
    setAuthor("");
  }

  async function abandon(id: string | null) {
    if (id) await cancelReaderImport(id).catch(() => {});
  }

  function handleOpenChange(next: boolean) {
    if (busy) return; // an in-flight upload can't be abandoned from here
    if (!next) {
      void abandon(bookId);
      reset();
    }
    setOpen(next);
  }

  function pickFile(picked: File) {
    if (picked.size > BOOK_MAX_BYTES) {
      setError(BOOK_MAX_SIZE_MESSAGE);
      return;
    }
    setFile(picked);
    setError(null);
  }

  const ready = tab === "file" ? file !== null : tab === "paste" ? text.trim().length > 0 : url.trim().length > 0;

  async function handleImport() {
    setError(null);
    setBusy(tab === "link" ? "Fetching the page…" : "Uploading…");
    let id: string | null = null;
    try {
      const given = initial?.title ? { title: initial.title } : {};
      const created = await createReaderImport(
        tab === "file" && file
          ? { kind: "file", filename: file.name, fileSizeBytes: file.size, ...given }
          : tab === "paste"
            ? { kind: "paste", ...given }
            : { kind: "url", url: url.trim(), ...given }
      );
      if (!created.ok) {
        setError(created.message);
        return;
      }
      id = created.bookId;
      setBookId(id);
      if (created.upload) {
        const body = tab === "file" && file ? file : new Blob([text], { type: "text/plain" });
        const { error: upErr } = await createClient()
          .storage.from(BOOKS_BUCKET)
          .uploadToSignedUrl(created.upload.path, created.upload.token, body, { contentType: created.upload.contentType });
        if (upErr) throw upErr;
      }
      setBusy("Getting it ready to read…");
      const prepared = await prepareReaderDoc(id);
      if (!prepared.ok) {
        await abandon(id);
        setBookId(null);
        setError(prepared.message);
        return;
      }
      // The reader keeps the person's speed in this browser; the estimate should match what they will actually see.
      setWpm(loadSettings(browserStorage()).wpm || 300);
      setPreview(prepared.preview);
      setTitle(prepared.preview.title);
      setAuthor(prepared.preview.author ?? "");
    } catch (err) {
      await abandon(id);
      setBookId(null);
      const message = err instanceof Error ? err.message : UPLOAD_FAILED;
      setError(/exceeded the maximum allowed size/i.test(message) ? BOOK_MAX_SIZE_MESSAGE : UPLOAD_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function handleStart() {
    if (!bookId || !title.trim()) return;
    setBusy("Adding to your library…");
    const result = await confirmReaderImport(bookId, { title: title.trim(), author: author.trim() || null });
    if (!result.ok) {
      setBusy(null);
      setError(result.message);
      return;
    }
    const id = bookId;
    setBookId(null); // confirmed: closing must not cancel it
    setBusy(null);
    setOpen(false);
    reset();
    router.push(`/read/${id}`);
  }

  async function handleCancelPreview() {
    setBusy("Cancelling…");
    await abandon(bookId);
    setBusy(null);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm" data-testid="import-to-read-trigger" className="gap-1.5">
            <BookOpenText className="size-4" />
            Import to read
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{preview ? "Ready to read" : "Import to read"}</DialogTitle>
        </DialogHeader>

        {preview ? (
          <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto pr-1" data-testid="import-preview">
            <div className="flex flex-col gap-1">
              <Label htmlFor="import-title">Title</Label>
              <Input id="import-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="import-author">Author (optional)</Label>
              <Input id="import-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
            </div>
            <p className="text-sm text-muted-foreground" data-testid="import-stats">
              {preview.wordCount.toLocaleString()} words · {readingTimeLabel(preview.wordCount, wpm)} at {wpm} words per minute
              {preview.chapters.length > 1 ? ` · ${preview.chapters.length} chapters` : ""}
            </p>
            {preview.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-[var(--accent-warning)]">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {preview.chapters.length > 1 ? (
              <ol className="max-h-28 list-decimal overflow-y-auto pl-5 text-xs text-muted-foreground">
                {preview.chapters.slice(0, 40).map((c) => (
                  <li key={`${c.firstWord}-${c.title}`}>{c.title}</li>
                ))}
              </ol>
            ) : null}
            <p className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{preview.sample}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div role="group" aria-label="What to import" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  disabled={busy !== null}
                  onClick={() => {
                    setTab(id);
                    setError(null);
                  }}
                  className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-md text-sm", tab === id ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>

            {tab === "file" ? (
              <div
                data-testid="import-dropzone"
                onDragOver={(e) => {
                  if (busy !== null) return;
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const dropped = e.dataTransfer?.files?.[0];
                  if (busy === null && dropped) pickFile(dropped);
                }}
                className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center", dragging ? "border-ring bg-muted/40" : "border-border")}
              >
                <Upload className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground" data-testid="import-file-label">
                  {file ? file.name : "Drop a file here, or choose one. PDF, EPUB, text, Markdown or HTML — up to 50 MB."}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                  {file ? "Choose a different file" : "Choose file"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  data-testid="import-file-input"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) pickFile(picked);
                  }}
                />
              </div>
            ) : null}

            {tab === "paste" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="import-text">Text to read</Label>
                <textarea
                  id="import-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  disabled={busy !== null}
                  placeholder="Paste an article, chapter or notes…"
                  className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            ) : null}

            {tab === "link" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="import-url">Article link</Label>
                <Input id="import-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={busy !== null} />
                <p className="text-xs text-muted-foreground">The page is fetched once and saved as clean text. Pages that need a login can&apos;t be imported — paste the text instead.</p>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {busy}
            </p>
          ) : null}
          {preview ? (
            <>
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={handleCancelPreview}>
                Cancel
              </Button>
              <Button type="button" disabled={busy !== null || !title.trim()} onClick={handleStart}>
                Start reading
              </Button>
            </>
          ) : (
            <Button type="button" disabled={busy !== null || !ready} onClick={handleImport} className="w-full sm:w-auto">
              {error ? "Try again" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
