"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareLectureUpload, finalizeLectureUpload, removeLectureRecording, getLectureRecordingUrl } from "@/app/(app)/school/lecture-actions";
import { requestTranscription } from "@/app/(app)/school/transcript-actions";
import { createClient } from "@/lib/supabase/client";
import { LECTURE_MAX_BYTES, LECTURE_MAX_SIZE_MESSAGE } from "@/lib/school/lecture-limits";
import { Button } from "@/components/ui/button";

// Mirrors lib/ai/transcription.ts's OPENAI_MAX_FILE_SIZE_BYTES -- not
// imported directly, since that's a `server-only` module and this is a
// Client Component (check-client-server-only.mjs forbids the import
// outright). Keep this literal in sync with that file's own constant.
// (lib/school/lecture-limits.ts, by contrast, has no `server-only` guard --
// LECTURE_MAX_BYTES/LECTURE_MAX_SIZE_MESSAGE below ARE imported directly.)
const OPENAI_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type LectureRecording = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: string;
  transcriptStatus: "none" | "queued" | "processing" | "completed" | "failed";
  transcriptText: string | null;
  transcriptError: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * P3-14 (lecture recording/import + storage). Same overall shape as
 * SyllabusPanel (upload via a hidden file input into a Server Action,
 * private-bucket playback only ever through a freshly-minted signed URL)
 * but a LIST rather than a single slot -- a class can have many lecture
 * recordings, unlike its one syllabus.
 *
 * Playing a recording fetches its signed URL on demand and keeps it in
 * per-row state -- never pre-fetched for every row on mount, so opening this
 * panel with a long lecture list doesn't mint a burst of signed URLs nobody
 * asked to hear yet.
 */
export function LecturePanel({
  classId,
  lectures,
  editing = true,
  hasOpenAiKey = false,
  hasGoogleKey = false,
}: {
  classId: string;
  lectures: LectureRecording[];
  editing?: boolean;
  /** From transcript-actions.ts's getTranscriptionAvailability(). Neither key
   * means "Transcribe" is shown but disabled with a clear reason, same
   * posture SyllabusPanel takes with editing-gated buttons -- an absent
   * feature, never a broken one. */
  hasOpenAiKey?: boolean;
  hasGoogleKey?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<{ id: string; url: string; mimeType: string } | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);

  /**
   * Three hops (a9 review, P3-14): prepare (Server Action -- validates
   * ownership + mime/size, mints a signed upload url) -> the browser
   * uploads the actual bytes straight to Storage, never through a Server
   * Action's own request body -> finalize (Server Action -- re-reads the
   * real object and only then writes the row). A failure at the upload hop
   * leaves an unfinalized object in Storage with no row pointing at it --
   * same "orphaned object, never lost data" posture as every other upload
   * in this codebase, just with the orphan risk moved earlier.
   */
  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later (e.g. after a failed upload)
    if (!file) return;
    setUploadError(null);
    // Client-side size check FIRST (P3-14 04-verification finding) -- no
    // upload attempt even starts for a file that's going to be rejected,
    // rather than spending minutes of upload time to learn that from
    // prepareLectureUpload or, worse, from Storage's own raw rejection
    // partway through uploadToSignedUrl.
    if (file.size > LECTURE_MAX_BYTES) {
      setUploadError(LECTURE_MAX_SIZE_MESSAGE);
      return;
    }
    setIsUploading(true);
    (async () => {
      try {
        const { path, token } = await prepareLectureUpload(classId, file.name, file.type, file.size);
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage.from("lectures").uploadToSignedUrl(path, token, file);
        if (uploadError) throw uploadError;
        await finalizeLectureUpload(classId, path);
        router.refresh();
      } catch (err) {
        // Storage's own raw rejection for an over-limit object (this can
        // still happen despite the client-side pre-check above, e.g. a
        // stale/lowered limit the client hasn't refreshed) reads as
        // "exceeded the maximum allowed size" -- mapped to the same
        // friendly, actionable message rather than shown verbatim.
        const message = err instanceof Error ? err.message : "Upload failed -- try again";
        setUploadError(/exceeded the maximum allowed size/i.test(message) ? LECTURE_MAX_SIZE_MESSAGE : message);
      } finally {
        setIsUploading(false);
      }
    })();
  }

  function play(id: string) {
    setPlaybackError(null);
    setPlayingId(id);
    startTransition(async () => {
      const result = await getLectureRecordingUrl(id);
      if (!result) {
        setPlaybackError("This recording is no longer available.");
        setPlayingId(null);
        return;
      }
      setPlaybackUrl({ id, url: result.url, mimeType: result.mimeType });
    });
  }

  /**
   * Requests (or retries) a transcription. No client-side polling for
   * completion -- same "check on next refresh" posture the rest of this
   * panel already uses (router.refresh() after every mutation); a
   * queued/processing row just shows a status label until the user next
   * reopens or refreshes the page. Deliberate scope limit, not an
   * oversight -- a live-updating status would need either a poll loop or a
   * realtime subscription, neither of which this pass builds.
   */
  function transcribe(id: string) {
    startTransition(async () => {
      await requestTranscription(id);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await removeLectureRecording(id);
      setConfirmingRemoveId(null);
      if (playbackUrl?.id === id) setPlaybackUrl(null);
      if (playingId === id) setPlayingId(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Lecture recordings</h3>
        <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChosen} />
        {editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Uploading…" : "Upload recording"}
          </Button>
        )}
      </div>

      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

      {lectures.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recordings yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lectures.map((l) => {
            const tooLargeForOpenAi = l.sizeBytes > OPENAI_MAX_FILE_SIZE_BYTES;
            const canTranscribe = hasOpenAiKey ? true : hasGoogleKey ? true : false;
            const transcribeDisabledReason = !canTranscribe
              ? "Needs an OpenAI or Gemini key in Settings"
              : tooLargeForOpenAi && !hasGoogleKey
                ? "Too large for OpenAI (25MB limit) — needs a Gemini key"
                : null;
            return (
            <li key={l.id} className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="truncate text-sm" title={l.originalFilename}>
                  {l.originalFilename}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(l.sizeBytes)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => play(l.id)}>
                  Play
                </Button>
                {editing && (l.transcriptStatus === "none" || l.transcriptStatus === "failed") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending || !!transcribeDisabledReason}
                    title={transcribeDisabledReason ?? undefined}
                    onClick={() => transcribe(l.id)}
                  >
                    {l.transcriptStatus === "failed" ? "Retry transcription" : "Transcribe"}
                  </Button>
                )}
                {editing &&
                  (confirmingRemoveId === l.id ? (
                    <>
                      <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={() => remove(l.id)}>
                        Confirm remove
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmingRemoveId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setConfirmingRemoveId(l.id)}
                    >
                      Remove
                    </Button>
                  ))}
              </div>
              {playingId === l.id && (
                <>
                  {playbackUrl?.id === l.id ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption -- a lecture recording has no caption track to offer
                    <audio controls autoPlay className="w-full" src={playbackUrl.url}>
                      Your browser can&apos;t play this audio file.
                    </audio>
                  ) : playbackError ? (
                    <p className="text-xs text-destructive">{playbackError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                </>
              )}
              {(l.transcriptStatus === "queued" || l.transcriptStatus === "processing") && (
                <p className="text-xs text-muted-foreground">Transcribing… check back in a bit.</p>
              )}
              {l.transcriptStatus === "failed" && l.transcriptError && (
                <p className="text-xs text-destructive">{l.transcriptError}</p>
              )}
              {l.transcriptStatus === "completed" && l.transcriptText && (
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setExpandedTranscriptId((prev) => (prev === l.id ? null : l.id))}
                  >
                    {expandedTranscriptId === l.id ? "Hide transcript" : "View transcript"}
                  </Button>
                  {expandedTranscriptId === l.id && (
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs">
                      {l.transcriptText}
                    </p>
                  )}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
