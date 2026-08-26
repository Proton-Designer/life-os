"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadClassSyllabus, removeClassSyllabus, getClassSyllabusUrl } from "@/app/(app)/school/class-actions";
import { Button } from "@/components/ui/button";
import { SyllabusViewerDialog, type SyllabusViewerResult } from "@/components/school/syllabus-viewer-dialog";

/**
 * Right half of the expanded class view (item 6c): upload, view (in a
 * popup), remove, and swap out a class's syllabus. `hasSyllabus` is the
 * only thing this needs from the parent — the actual file content is
 * never held in this component's state, only ever streamed straight from
 * an `<input type="file">` into a Server Action.
 */
export function SyllabusPanel({ classId, hasSyllabus }: { classId: string; hasSyllabus: boolean }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerResult, setViewerResult] = useState<SyllabusViewerResult | null>(null);

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file (e.g. after a failed upload) later
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      await uploadClassSyllabus(classId, formData);
      router.refresh();
    });
  }

  function view() {
    startTransition(async () => {
      const result = await getClassSyllabusUrl(classId);
      setViewerResult(result);
      setViewerOpen(true);
    });
  }

  function remove() {
    startTransition(async () => {
      await removeClassSyllabus(classId);
      setConfirmingRemove(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Syllabus</h3>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileChosen}
      />
      {hasSyllabus ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={view}>
            View
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
            Swap out
          </Button>
          {confirmingRemove ? (
            <>
              <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={remove}>
                Confirm remove
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemove(true)}>
              Remove
            </Button>
          )}
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
          Upload syllabus
        </Button>
      )}

      <SyllabusViewerDialog open={viewerOpen} onOpenChange={setViewerOpen} result={viewerResult} />
    </div>
  );
}
