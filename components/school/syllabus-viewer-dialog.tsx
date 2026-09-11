"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SyllabusFileKind } from "@/app/(app)/school/class-actions";
import { cn } from "@/lib/utils";

export type SyllabusViewerResult = { url: string; kind: SyllabusFileKind };

/**
 * Supabase Storage signed URLs are cross-origin, so the HTML `download`
 * attribute is silently ignored (it only forces a download same-origin) —
 * this is the actual mechanism Supabase exposes for that instead.
 */
function forceDownloadUrl(url: string): string {
  return url.includes("?") ? `${url}&download=` : `${url}?download=`;
}

/**
 * Whether THIS browser can render a PDF inside an `<iframe>`.
 *
 * `navigator.pdfViewerEnabled` is the standardised property for exactly
 * this question (Chrome 94+, Safari 16.4+, Firefox 90+). We read the
 * property itself rather than sniffing the user agent, which is only a
 * proxy for it — and the wrong proxy on every browser that doesn't fit
 * the pattern being matched.
 *
 * `undefined` (a browser too old to expose it) resolves to `true`, which
 * is the pre-2026-09-10 behaviour: an unrecognised browser is far more
 * likely to have a viewer than not, and a false negative here costs a
 * working inline render. Only an explicit `false` changes anything.
 */
function canRenderPdfInline(): boolean {
  if (typeof navigator === "undefined") return true;
  const flag = (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
  return flag === undefined ? true : flag;
}

/**
 * The PDF path for a browser with no built-in viewer — phones, chiefly.
 *
 * Deliberately NOT `DownloadFallback`: Ayman's original C1 report was that
 * View downloaded the file instead of showing it, so answering the same
 * tap with a Download button would be conceding the exact complaint. A new
 * tab hands the file to the browser's OWN PDF viewer, which is viewing.
 * Download stays available, demoted to a secondary link.
 *
 * The primary link carries the plain signed URL, never `forceDownloadUrl`
 * — the `?download=` parameter is what turns a view into a save.
 */
function PdfHandoff({ url }: { url: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        This browser can&apos;t display a PDF inside the app. Opening it in a new tab uses the
        browser&apos;s own viewer — it won&apos;t save the file.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent/50"
      >
        Open syllabus
      </a>
      <a
        href={forceDownloadUrl(url)}
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Download instead
      </a>
    </div>
  );
}

function DownloadFallback({ url, message }: { url: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <a
        href={forceDownloadUrl(url)}
        className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent/50"
      >
        Download
      </a>
    </div>
  );
}

/**
 * Renders a syllabus at a signed URL inside a popup (item 6c: "view it in
 * a popup screen" — never a download, per Ayman's C1 report). The URL is
 * minted fresh right before this opens (syllabus-panel.tsx) and is never
 * persisted — closing this dialog and reopening it re-fetches a new one
 * rather than reusing an old, possibly expired, signed URL.
 *
 * PDFs render inline via `<iframe>` ONLY where the browser has a built-in
 * PDF viewer (`canRenderPdfInline`). The claim this comment used to make —
 * "that already worked before C1; this branch is untouched" — was true of
 * desktop and false of Ayman's phone, which is the device the C1 report
 * came from. Mobile Chromium ships no PDF plugin, so the iframe navigated,
 * failed to display, and handed the file to the downloader: a titled modal
 * with a 380x649 void in it, and a download he never asked for. The
 * "honest fallback" below never fired, because nothing threw — the iframe
 * path LOOKED successful, so the code never reached the honest branch.
 * A silent success is how an honest failure gets bypassed. Those browsers
 * now get `PdfHandoff` instead. .docx (the ONE format no browser renders inline —
 * every other syllabus Ayman has is a PDF) is rendered client-side with
 * `docx-preview`, dynamically imported so the ~975KB library only loads
 * when a .docx is actually opened, never in the main bundle. Anything else
 * ("other" — e.g. legacy .doc, which the bucket accepts but docx-preview
 * cannot render) gets an honest "can't preview" message plus a Download
 * button up front — never a silent fall-through to the iframe, which is
 * exactly how a download masquerades as "viewing."
 *
 * The docx container stays mounted (visually hidden, not unmounted) while
 * an error is shown — Opus Lead review caught that unmounting it on error
 * made `containerRef.current` permanently null, so a single transient
 * failure latched "can't be previewed" for every subsequent docx view in
 * the session, surviving even a fresh open with a good URL.
 */
export function SyllabusViewerDialog({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SyllabusViewerResult | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [docxError, setDocxError] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  // `null` until the client has answered the capability question. The PDF
  // branch renders NOTHING until then, and that is the entire fix: mounting
  // the <iframe> is itself the action that triggers the download on a
  // browser with no viewer, so "mount it, then correct" would fire the bug
  // once per open before correcting it. It cannot be read during render
  // either — the server has no `navigator`, and guessing would be a
  // hydration mismatch. One frame of "Loading…", then the right branch.
  const [pdfInline, setPdfInline] = useState<boolean | null>(null);

  useEffect(() => {
    setPdfInline(canRenderPdfInline());
  }, []);

  useEffect(() => {
    if (!open || result?.kind !== "docx") return;
    setDocxError(false);
    setDocxLoading(true);
    const url = result.url;
    let cancelled = false;

    (async () => {
      try {
        const [{ renderAsync }, response] = await Promise.all([import("docx-preview"), fetch(url)]);
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        // Read the ref lazily, after the fetch/import round trip, not
        // before it: on the render where `open` and `result` both flip
        // together (exactly what syllabus-panel.tsx does), the Dialog's
        // portal hasn't attached this ref to the DOM yet when the effect
        // first runs — capturing it up front made the whole render silently
        // never start, stuck on "Loading document…" forever. By the time
        // the network round trip resolves, the portal has always settled.
        const container = containerRef.current;
        if (!container) throw new Error("syllabus viewer container not mounted");
        container.innerHTML = "";
        await renderAsync(blob, container, container, { inWrapper: true, ignoreLastRenderedPageBreak: false });
      } catch {
        if (!cancelled) setDocxError(true);
      } finally {
        if (!cancelled) setDocxLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-3xl flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Syllabus</DialogTitle>
        </DialogHeader>
        {!result ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the syllabus.</p>
        ) : result.kind === "other" ? (
          <DownloadFallback url={result.url} message="This document can't be previewed." />
        ) : result.kind === "docx" ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2">
            {docxLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading document…</p>}
            {docxError && (
              <div className="absolute inset-0 bg-muted/20">
                <DownloadFallback url={result.url} message="This document can't be previewed." />
              </div>
            )}
            <div ref={containerRef} className={cn(docxError && "invisible")} />
          </div>
        ) : pdfInline === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading document…</p>
        ) : pdfInline ? (
          <iframe src={result.url} title="Syllabus" className="min-h-0 flex-1 rounded-md border border-border/40" />
        ) : (
          <PdfHandoff url={result.url} />
        )}
      </DialogContent>
    </Dialog>
  );
}
