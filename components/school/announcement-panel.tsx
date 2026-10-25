"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractAnnouncementDeliverables, getAnnouncementHistory, type AnnouncementHistoryEntry } from "@/app/(app)/school/announcement-actions";
import { Button } from "@/components/ui/button";
import { AgentJobsStatus } from "@/components/agent/agent-jobs-status";

const EXTRACTION_OUTCOME_MESSAGE: Record<string, string> = {
  too_short: "That doesn't look like enough text to parse — paste the full announcement.",
  no_key: "Add an API key in Settings to parse announcements automatically, or add deliverables manually.",
  unavailable: "AI parsing isn't available right now — try again shortly, or add deliverables manually.",
  parse_failed: "Couldn't make sense of the parse result — try again, or add deliverables manually.",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  confirming: "Confirming",
  confirmed: "Confirmed",
};

function truncateSnippet(text: string | null, max = 120): string {
  if (!text) return "(no text saved)";
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * P2-07 — paste a course announcement, AI-parse it into a staged batch
 * (reusing the SAME pending -> confirming -> confirmed pipeline the
 * syllabus path already uses, via `SyllabusReviewPanel` — that panel
 * already renders any pending batch regardless of source, see
 * lib/school/get-class-cards.ts's own comment), plus the per-course
 * history list the acceptance criteria asks for.
 *
 * Deliberately does NOT render its own review UI — the pending batch this
 * produces surfaces through `classData.pendingStagingBatch` exactly like a
 * syllabus batch does, and `SyllabusReviewPanel` (already source-aware,
 * see that file's own header) is the one and only review surface.
 */
export function AnnouncementPanel({ classId, editing = true }: { classId: string; editing?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<AnnouncementHistoryEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);

  function handleParse() {
    setMessage(null);
    startTransition(async () => {
      const result = await extractAnnouncementDeliverables(classId, text);
      if (result.outcome === "queued") {
        // No AI key but a connected agent: the parse waits in the agent queue; the status card below shows it.
        setText("");
        setJobsRefreshKey((k) => k + 1);
      } else if (result.outcome === "extracted") {
        setText("");
        if (result.itemCount === 0) {
          setMessage(null); // SyllabusReviewPanel's own #19-equivalent empty state covers this once it renders
        } else if (result.truncated) {
          setMessage(`Parsed ${result.itemCount} item${result.itemCount === 1 ? "" : "s"} — this announcement was long, so only the first part was read.`);
        }
      } else {
        setMessage(EXTRACTION_OUTCOME_MESSAGE[result.outcome] ?? "Parsing didn't work — try again or add manually.");
      }
      setHistory(null); // stale until reopened
      router.refresh();
    });
  }

  // Fetches once when the list is opened, and again whenever it's re-opened
  // after `history` was invalidated (a successful parse sets it back to
  // null) — so a reopened list after parsing something new is never stale,
  // without fetching on every render or on every parse regardless of
  // whether the list is even open.
  useEffect(() => {
    if (historyOpen && history === null) {
      getAnnouncementHistory(classId).then(setHistory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, history, classId]);

  function toggleHistory() {
    setHistoryOpen((prev) => !prev);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Announcements</h3>
      {editing && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a course announcement (e.g. a Canvas post or email) to parse for schedule changes…"
            rows={4}
            className="w-full rounded-md border border-input bg-transparent p-2 text-xs"
          />
          <Button type="button" variant="outline" size="sm" disabled={isPending || text.trim().length === 0} onClick={handleParse} className="self-start">
            {isPending ? "Parsing…" : "Parse announcement"}
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      <AgentJobsStatus classId={classId} kinds={["school.announcement_extract"]} refreshKey={jobsRefreshKey} />

      <Button type="button" variant="ghost" size="sm" onClick={toggleHistory} className="self-start">
        {historyOpen ? "Hide history" : "Announcement history"}
      </Button>
      {historyOpen && (
        <div className="flex flex-col gap-1.5">
          {history === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No announcements parsed for this class yet.</p>
          ) : (
            history.map((entry) => (
              <div key={entry.id} data-testid={`announcement-history-${entry.id}`} className="rounded-lg border border-border/40 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</span>
                  <span className="text-muted-foreground">
                    {STATUS_LABEL[entry.status] ?? entry.status} · {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 italic text-foreground/80">&ldquo;{truncateSnippet(entry.rawText)}&rdquo;</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
