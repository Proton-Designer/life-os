"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, EyeOff, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClassShare, revokeClassShare, getClassShareStatus, getSharePreview } from "@/app/(app)/school/class-share-actions";
import type { ClassShareStatus, PublicQuestionBank } from "@/lib/school/class-share-core";

/**
 * P3-08 — the owner's Share controls: a Preview (Opus Lead's requirement
 * #4, "show the owner exactly what becomes public" before/at creation),
 * Create/Revoke, and the one-time raw link display. Self-contained:
 * fetches its own status on mount rather than threading a new field
 * through class-detail-dialog.tsx's whole data chain, since this section
 * only matters while the dialog is actually open (same reasoning
 * distraction-capture-dialog.tsx's own on-open fetch already uses for a
 * dialog-scoped read).
 *
 * The full share URL is held ONLY in this component's own state, for the
 * lifetime of this mount — createClassShare's raw token is never stored
 * anywhere durable, and reopening this dialog later shows "Sharing is on"
 * with no way to see the link again short of Revoke + Create.
 */
export function ClassShareSection({ classId }: { classId: string }) {
  const [status, setStatus] = useState<ClassShareStatus | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublicQuestionBank | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getClassShareStatus(classId).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  function loadPreview() {
    startTransition(async () => {
      const result = await getSharePreview(classId);
      setPreview(result);
      setPreviewOpen(true);
    });
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createClassShare(classId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setShareUrl(`${window.location.origin}/share/${result.rawToken}`);
      setStatus({ active: true, createdAt: new Date().toISOString() });
      setPreviewOpen(false);
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      await revokeClassShare(classId);
      setShareUrl(null);
      setStatus({ active: false, createdAt: null });
    });
  }

  if (status === null) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Share2 className="size-4" aria-hidden />
        Public share
      </div>

      {!status.active && !previewOpen && (
        <>
          <p className="text-xs text-muted-foreground">Not shared. Anyone who is not you cannot see this bank.</p>
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={loadPreview} disabled={isPending}>
            <Eye className="mr-1.5 size-3.5" aria-hidden />
            Preview what would become public
          </Button>
        </>
      )}

      {previewOpen && preview && (
        <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/30 p-3">
          <p className="text-xs font-medium">
            "{preview.className}" — {preview.questions.length} question{preview.questions.length === 1 ? "" : "s"} would be public, read-only:
          </p>
          <ul className="flex flex-col gap-1">
            {preview.questions.map((q, i) => (
              <li key={i} className="truncate text-xs text-muted-foreground">
                {q.prompt}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleCreate} disabled={isPending}>
              Create link
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status.active && (
        <>
          <p className="text-xs text-muted-foreground">Sharing is on — anyone with the link can view and drill this bank, read-only.</p>
          {shareUrl && (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-input bg-background px-2 py-1 text-xs">{shareUrl}</code>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(shareUrl)}>
                Copy
              </Button>
            </div>
          )}
          {!shareUrl && <p className="text-xs text-muted-foreground">The link was only shown once, at creation. Revoke and create a new one if it's lost.</p>}
          <Button type="button" variant="destructive" size="sm" className="w-fit" onClick={handleRevoke} disabled={isPending}>
            <EyeOff className="mr-1.5 size-3.5" aria-hidden />
            Revoke
          </Button>
        </>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
