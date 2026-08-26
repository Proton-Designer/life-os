"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SyllabusFileKind } from "@/app/(app)/school/class-actions";

export type SyllabusViewerResult = { url: string; kind: SyllabusFileKind };

function DownloadFallback({ url, message }: { url: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <a href={url} download className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent/50">
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
 * PDFs render inline via `<iframe>` — that already worked before C1; this
 * branch is untouched. .docx (the ONE format no browser renders inline —
 * every other syllabus Ayman has is a PDF) is rendered client-side with
 * `docx-preview`, dynamically imported so the ~975KB library only loads
 * when a .docx is actually opened, never in the main bundle. Anything else
 * ("other" — e.g. legacy .doc, which the bucket accepts but docx-preview
 * cannot render) gets an honest "can't preview" message plus a Download
 * button up front — never a silent fall-through to the iframe, which is
 * exactly how a download masquerades as "viewing."
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

  useEffect(() => {
    if (!open || result?.kind !== "docx") return;
    const container = containerRef.current;
    if (!container) return;
    const url = result.url;

    let cancelled = false;
    setDocxError(false);
    setDocxLoading(true);
    container.innerHTML = "";

    (async () => {
      try {
        const [{ renderAsync }, response] = await Promise.all([import("docx-preview"), fetch(url)]);
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
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
          docxError ? (
            <DownloadFallback url={result.url} message="This document can't be previewed." />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2">
              {docxLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading document…</p>}
              <div ref={containerRef} />
            </div>
          )
        ) : (
          <iframe src={result.url} title="Syllabus" className="min-h-0 flex-1 rounded-md border border-border/40" />
        )}
      </DialogContent>
    </Dialog>
  );
}
