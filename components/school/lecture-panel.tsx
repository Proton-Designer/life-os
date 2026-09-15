"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareLectureUpload, finalizeLectureUpload, removeLectureRecording, getLectureRecordingUrl } from "@/app/(app)/school/lecture-actions";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export type LectureRecording = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: string;
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
}: {
  classId: string;
  lectures: LectureRecording[];
  editing?: boolean;
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
        setUploadError(err instanceof Error ? err.message : "Upload failed -- try again");
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
          {lectures.map((l) => (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
