"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cancelAgentJob, dismissAgentJob, listAgentJobs } from "@/app/(app)/agent-jobs-actions";
import type { AgentJobDraft, AgentJobView } from "@/lib/agent-jobs/types";
import { WaitingForAgent } from "./waiting-for-agent";

const POLL_MS = 5000;
const WHAT: Record<string, string> = {
  "school.announcement_extract": "Your announcement",
  "school.syllabus_extract": "Your syllabus",
  "school.question_draft": "Your question drafts",
};

/**
 * Shows a class's queued-for-agent work: "Waiting for your agent" / "working" cards, failed ones with Dismiss, and (question
 * drafts) a "ready" card whose Review button hands the drafts to the caller. Polls every 5 s while something is waiting and the
 * tab is visible; when a job leaves the live set (an agent finished it) it refreshes the page so the result (a staged batch) shows.
 */
export function AgentJobsStatus({
  classId,
  kinds,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  refreshKey = 0,
  onReviewDrafts,
}: {
  classId: string;
  kinds: string[];
  /** Defaults to the browser's time zone. */
  timezone?: string;
  /** Bump to re-read now (e.g. right after queuing). */
  refreshKey?: number;
  onReviewDrafts?: (jobId: string, drafts: AgentJobDraft[]) => void;
}) {
  const router = useRouter();
  // `kinds` is usually an inline array literal (a new identity every render): key the callbacks on its contents, or the load effect would loop.
  const kindsKey = kinds.join("|");
  const [jobs, setJobs] = useState<AgentJobView[]>([]);
  const liveIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const wanted = kindsKey.split("|");
    const next = (await listAgentJobs(classId).catch(() => [])).filter((j) => wanted.includes(j.kind));
    const nowLive = new Set(next.filter((j) => j.state === "waiting" || j.state === "working").map((j) => j.id));
    const finished = [...liveIdsRef.current].some((id) => !nowLive.has(id));
    liveIdsRef.current = nowLive;
    setJobs(next);
    if (finished) router.refresh();
  }, [classId, kindsKey, router]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const anyLive = jobs.some((j) => j.state === "waiting" || j.state === "working");
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [anyLive, load]);

  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {jobs.map((job) =>
        job.state === "ready_drafts" ? (
          <div key={job.id} data-testid="agent-drafts-ready" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">
            <p>
              Your agent drafted {job.drafts?.length ?? 0} question{job.drafts?.length === 1 ? "" : "s"}. Review them before they go in the bank.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!job.drafts || !onReviewDrafts) return;
                onReviewDrafts(job.id, job.drafts);
                await dismissAgentJob(job.id);
                await load();
              }}
            >
              Review
            </Button>
          </div>
        ) : (
          <WaitingForAgent
            key={job.id}
            what={WHAT[job.kind] ?? "Your request"}
            state={job.state === "failed" ? "failed" : job.state}
            createdAt={job.createdAt}
            timezone={timezone}
            error={job.error}
            onCancel={async () => {
              await cancelAgentJob(job.id);
              await load();
            }}
            onDismiss={async () => {
              await dismissAgentJob(job.id);
              await load();
            }}
          />
        ),
      )}
    </div>
  );
}
