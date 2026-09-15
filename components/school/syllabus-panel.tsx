"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadClassSyllabus, removeClassSyllabus, getClassSyllabusUrl } from "@/app/(app)/school/class-actions";
import { extractSyllabusDeliverables } from "@/app/(app)/school/syllabus-extraction-actions";
import { Button } from "@/components/ui/button";
import { SyllabusViewerDialog, type SyllabusViewerResult } from "@/components/school/syllabus-viewer-dialog";

const EXTRACTION_OUTCOME_MESSAGE: Record<string, string> = {
  unreadable: "This PDF couldn't be read — it may be encrypted or corrupted. Try a different file or add deliverables manually.",
  no_text_layer: "Couldn't read text from this PDF — it may be a scanned image. Enter deliverables manually below.",
  no_key: "Add an API key in Settings to extract deliverables automatically, or add them manually below.",
  unavailable: "AI extraction isn't available right now — try again shortly, or add deliverables manually below.",
  parse_failed: "Couldn't make sense of the extraction result — try again, or add deliverables manually below.",
};

/**
 * Right half of the expanded class view (item 6c): upload, view (in a
 * popup), remove, and swap out a class's syllabus. `hasSyllabus` is the
 * only thing this needs from the parent — the actual file content is
 * never held in this component's state, only ever streamed straight from
 * an `<input type="file">` into a Server Action.
 *
 * `editing` gates everything except View (Ayman: "Syllabus shows ONLY
 * 'View'" outside edit mode) — Upload/Swap out/Remove are all
 * destructive-adjacent or state-changing, consistent with every other
 * mutation in the expanded view living behind the one outer Edit toggle.
 */
export function SyllabusPanel({
  classId,
  hasSyllabus,
  editing = true,
}: {
  classId: string;
  hasSyllabus: boolean;
  editing?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isExtracting, startExtracting] = useTransition();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerResult, setViewerResult] = useState<SyllabusViewerResult | null>(null);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);

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

  /** Phase 1 #16 — independent of the plain upload above: its own PDF-only file
   * input (Opus Lead scope ruling — PNG/JPEG need a vision model, gated on the
   * multi-provider work), and it never touches `classes.syllabus_path` — the
   * uploaded bytes are read for text only, never stored (see
   * syllabus-extraction-actions.ts's own header). */
  function handleExtractFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtractionMessage(null);
    const formData = new FormData();
    formData.set("file", file);
    startExtracting(async () => {
      const result = await extractSyllabusDeliverables(classId, formData);
      if (result.outcome === "extracted" && result.itemCount === 0) {
        setExtractionMessage(null); // the review panel's own #19 empty state covers this once it renders
      } else if (result.outcome !== "extracted") {
        setExtractionMessage(EXTRACTION_OUTCOME_MESSAGE[result.outcome] ?? "Extraction didn't work — try again or add manually.");
      } else if (result.truncated) {
        setExtractionMessage(`Extracted ${result.itemCount} item${result.itemCount === 1 ? "" : "s"} — this file was long, so only the first part was read. Check for anything missing.`);
      }
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
      <input ref={extractInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleExtractFileChosen} />
      {editing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isExtracting}
          onClick={() => extractInputRef.current?.click()}
          className="self-start"
        >
          {isExtracting ? "Extracting…" : "Extract deliverables from PDF"}
        </Button>
      )}
      {extractionMessage && <p className="text-xs text-muted-foreground">{extractionMessage}</p>}
      {hasSyllabus ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={view}>
            View
          </Button>
          {editing && (
            <>
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
            </>
          )}
        </div>
      ) : (
        editing && (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
            Upload syllabus
          </Button>
        )
      )}

      <SyllabusViewerDialog open={viewerOpen} onOpenChange={setViewerOpen} result={viewerResult} />
    </div>
  );
}
