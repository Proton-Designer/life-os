"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { confirmStagingBatch, updateStagedDeliverable, deleteStagedDeliverable } from "@/app/(app)/school/staging-actions";
import { ASSESSMENT_TYPES, type AssessmentType } from "@/lib/school/assessment-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassCardData } from "@/lib/school/get-class-cards";

type PendingBatch = NonNullable<ClassCardData["pendingStagingBatch"]>;
type DraftDeliverable = { id: string; name: string; type: AssessmentType; date: string };

const TYPE_LABEL: Record<AssessmentType, string> = {
  quiz: "Quiz",
  exam: "Exam",
  final_midterm: "Midterm/Final",
  homework_assignment: "Homework/Assignment",
  project_paper: "Project/Paper",
};

/**
 * Phase 1 #16/#17/#19 — reviewing a syllabus extraction batch before it can touch
 * a single real row. Nothing lands unconfirmed (S2's own spec, verbatim): every
 * field here is editable, rejecting an item is a plain client-side removal + a
 * DELETE, and #18's `confirmStagingBatch` is the only path that ever creates a
 * real `class_assessments` row from any of this.
 *
 * Edits are staged locally and saved just before confirming, not per-keystroke —
 * same "stage, then commit as one action" shape class-detail-dialog.tsx already
 * uses for its own course-detail fields, chosen here so a short review list
 * doesn't fire a Server Action on every character typed.
 */
/** P2-07: this panel is fully source-agnostic already (confirm/edit/reject
 * all operate on batch/deliverable ids, never on `source`) -- only the
 * heading text needs to say the right thing for an announcement-sourced
 * batch instead of always saying "Syllabus". */
const SOURCE_LABEL: Record<string, string> = {
  syllabus: "Syllabus",
  announcement: "Announcement",
};

export function SyllabusReviewPanel({ batch }: { batch: PendingBatch }) {
  const router = useRouter();
  const sourceLabel = SOURCE_LABEL[batch.source] ?? "Extraction";
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<DraftDeliverable[]>(() =>
    batch.deliverables.map((d) => ({ id: d.id, name: d.name, type: d.type as AssessmentType, date: d.date ?? "" }))
  );
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [blockedNames, setBlockedNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = drafts.filter((d) => !rejectedIds.has(d.id));
  const byId = new Map(batch.deliverables.map((d) => [d.id, d]));

  function updateDraft(id: string, patch: Partial<DraftDeliverable>) {
    setBlockedNames(null);
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function reject(id: string) {
    setBlockedNames(null);
    setRejectedIds((prev) => new Set(prev).add(id));
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        // Reject first — a removed row must never be saved-then-confirmed.
        for (const id of rejectedIds) await deleteStagedDeliverable(id);
        // Save every remaining row's current draft — simpler than tracking a
        // per-field dirty flag for a review list this short, and idempotent
        // either way.
        for (const d of visible) {
          await updateStagedDeliverable(d.id, { name: d.name, type: d.type, date: d.date.trim() || null });
        }
        const result = await confirmStagingBatch(batch.id);
        if (result.status === "confirmed") {
          router.refresh();
        } else {
          // #17's no-guessing rule surfacing here: one or more rows still have no
          // date, so the batch can't fully confirm yet — name exactly which ones.
          setBlockedNames(result.remaining.map((r) => r.name));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't confirm — try again");
      }
    });
  }

  if (batch.deliverables.length === 0) {
    // #19 — a genuine, confident success state, never an error or a stuck spinner.
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
        <h3 className="text-sm font-medium">{sourceLabel} extraction</h3>
        <p className="text-xs text-muted-foreground">
          {batch.source === "announcement"
            ? "Nothing schedulable found in this announcement."
            : "Nothing schedulable found in this syllabus. Add deliverables manually below, or try a different file."}
        </p>
        <Button type="button" size="sm" className="self-start" disabled={isPending} onClick={handleConfirm}>
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      <h3 className="text-sm font-medium">Review extracted deliverables ({sourceLabel})</h3>
      <p className="text-xs text-muted-foreground">
        Check each item before confirming — nothing is added to your class until you confirm.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        {visible.map((d) => {
          const original = byId.get(d.id)!;
          const lowConfidence = original.confidence < 0.5;
          return (
            <div key={d.id} data-testid={`syllabus-review-row-${d.id}`} className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={d.name}
                  onChange={(e) => updateDraft(d.id, { name: e.target.value })}
                  aria-label={`Name for ${original.name || "new item"}`}
                  className="h-8 min-w-0 flex-1"
                />
                <select
                  value={d.type}
                  onChange={(e) => updateDraft(d.id, { type: e.target.value as AssessmentType })}
                  aria-label={`Type for ${original.name || "new item"}`}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  {ASSESSMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={d.date}
                  onChange={(e) => updateDraft(d.id, { date: e.target.value })}
                  aria-label={`Date for ${original.name || "new item"}`}
                  className="h-8 w-40 text-xs"
                />
                <button
                  type="button"
                  onClick={() => reject(d.id)}
                  aria-label={`Reject ${original.name || "this item"}`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
              {(!d.date || lowConfidence) && (
                <p className="text-xs text-accent-warning">
                  {!d.date && "No date — won't be confirmed until you add one."}
                  {!d.date && lowConfidence && " "}
                  {lowConfidence && "Low confidence — please check this item."}
                </p>
              )}
              {original.sourceSnippet && <p className="truncate text-xs text-muted-foreground italic">&ldquo;{original.sourceSnippet}&rdquo;</p>}
            </div>
          );
        })}
      </div>
      {blockedNames && blockedNames.length > 0 && (
        <p className="text-xs text-accent-warning">
          {blockedNames.length} item{blockedNames.length === 1 ? "" : "s"} still need{blockedNames.length === 1 ? "s" : ""} a date before{" "}
          {blockedNames.length === 1 ? "it can" : "they can"} be added: {blockedNames.join(", ")}.
        </p>
      )}
      <Button type="button" size="sm" className="self-start" disabled={isPending} onClick={handleConfirm}>
        Confirm {visible.length} item{visible.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}
