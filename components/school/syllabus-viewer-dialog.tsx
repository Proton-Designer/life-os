"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Renders a syllabus at a signed URL inside a popup (item 6c: "view it in
 * a popup screen"). The URL is minted fresh right before this opens
 * (syllabus-panel.tsx) and is never persisted — closing this dialog and
 * reopening it re-fetches a new one rather than reusing an old, possibly
 * expired, signed URL.
 */
export function SyllabusViewerDialog({
  open,
  onOpenChange,
  signedUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedUrl: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-3xl flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Syllabus</DialogTitle>
        </DialogHeader>
        {signedUrl ? (
          <iframe src={signedUrl} title="Syllabus" className="min-h-0 flex-1 rounded-md border border-border/40" />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the syllabus.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
