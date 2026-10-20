"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { ImportReaderDialog } from "@/components/reader/import-reader-dialog";

/** A drag that carries files (not selected text or a link dragged around the page). */
export function dragHasFiles(e: Pick<DragEvent, "dataTransfer">): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Drop a book anywhere on the library page: shows a hint while a file is dragged over the window, and on drop opens
 * the import dialog with that file already chosen. The visible "Import to read" buttons are the keyboard path and are
 * unchanged. Drops the import dialog's own drop area already handled (defaultPrevented) are left to it.
 */
export function LibraryDropTarget({ children }: { children: React.ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{ file: File; n: number } | null>(null);

  useEffect(() => {
    let depth = 0; // dragenter/leave fire for every child; the hint stays up until the drag has left the window
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      // Without this the browser would open the file in the tab on drop.
      if (dragHasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!dragHasFiles(e) || e.defaultPrevented) return; // not a file, or the import dialog's own drop area took it
      e.preventDefault();
      // An open dialog (an import in progress, any other) must not be replaced under the person.
      if (document.querySelector('[role="dialog"]')) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) setDropped((d) => ({ file, n: (d?.n ?? 0) + 1 }));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {children}
      {dropped ? <ImportReaderDialog key={dropped.n} defaultOpen initial={{ file: dropped.file }} trigger={<span hidden />} /> : null}
      {dragging ? (
        <div data-testid="library-drop-hint" aria-hidden className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ring px-10 py-8 text-center">
            <Upload className="size-8" />
            <p className="text-base font-medium">Drop to import and read</p>
            <p className="text-sm text-muted-foreground">PDF, EPUB, text, Markdown or HTML</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
