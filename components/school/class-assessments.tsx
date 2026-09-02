"use client";

import { Fragment, useState } from "react";
import { Trash2 } from "lucide-react";
import type { AssessmentType } from "@/app/(app)/school/class-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { RiskBand } from "@/lib/school/risk/assignment-risk";
import type { Confidence } from "@/lib/school/risk/types";

export type ClassAssessment = {
  id: string;
  name: string;
  type: AssessmentType;
  date: string;
  task_id: string | null;
  /** Always computed by the caller (lib/school/get-class-cards.ts) from
   * computeAssignmentRisk — the engine degrades gracefully rather than needing this to
   * be optional. `confidence` (not a boolean prop) is what actually drives ranking now
   * (R28): score alone isn't a rank claim when it was built from mostly-excluded factors. */
  risk: { score: number; band: RiskBand; confidence: Confidence };
};

// Short forms so a narrow column never truncates mid-word — same reasoning as
// TYPE_SHORT_LABEL below.
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", moderate: "Mod", low: "Low", insufficient: "None" };

/**
 * R28 (The Boss, 2026-09-02): within a list drawing on one factor set, confidence stays
 * OUT of the sort key (score already reflects the available evidence, renormalized) —
 * that rule is for the cross-domain arbiter comparing incomparable score qualities, not
 * this list. What confidence DOES drive here: an `insufficient`-confidence item is
 * grouped at the bottom with this prompt, rather than silently taking a rank its score
 * can't actually justify.
 *
 * Two different copies for two different states, per the Lead's ruling — not
 * interchangeable:
 * - MIXED (some but not all items insufficient): this per-group prompt, right above the
 *   group it explains. "Grouped at the bottom" is a meaningful thing to say here.
 * - ALL insufficient (the only state reachable today — see the sort's own comment for
 *   why): `ALL_INSUFFICIENT_CAPTION` instead. "Grouped at the bottom" is meaningless when
 *   there is no top to be below; the caption explains the ordering, which is the more
 *   useful thing to say when nothing is ranked at all.
 */
const INSUFFICIENT_GROUP_PROMPT = "rate difficulty to rank this";
const ALL_INSUFFICIENT_CAPTION = "ranked by due date until you rate difficulty.";

const TYPE_LABEL: Record<AssessmentType, string> = {
  quiz: "Quiz",
  exam: "Exam",
  midterm_final: "Midterm/Final",
};

// Short form for the read-only row display only (the <select> and the
// type-picker still use the full TYPE_LABEL, where there's no column-width
// pressure). Reusing R6's exact task-type color tokens (lib/tasks/task-
// type.ts's TASK_TYPE_COLOR) for the matching categories — this row and its
// linked task, one section down, now read as visibly the same category.
const TYPE_SHORT_LABEL: Record<AssessmentType, string> = {
  quiz: "Quiz",
  exam: "Exam",
  midterm_final: "Mid/Final",
};
const TYPE_COLOR: Record<AssessmentType, string> = {
  quiz: "text-accent-warning",
  exam: "text-destructive",
  midterm_final: "text-accent-coop",
};

// Name gets the remaining space; Type/Date/Actions are fixed and as narrow
// as a short label allows — the exact inversion of the original <table>,
// where "Midterm/Final" (a category repeated on every row) claimed several
// times the width of the assessment's own name, crushing it to "Mid…"/
// "Tak…" on a phone (Ayman's actual mobile screen, and the failure a
// temporarily-seeded long title surfaced during review).
const ROW_GRID = "grid-cols-[minmax(0,1fr)_4rem_4.5rem_3rem_1.75rem]";

/**
 * Left half of the expanded class view (item 6c / B2 redesign, 2026-08-26
 * afternoon batch). class-detail-dialog.tsx owns the `assessments` array
 * and hands it down with onAdd/onUpdate/onRemove callbacks.
 *
 * Add is available regardless of `editing` and commits immediately (the
 * parent's onAdd calls the server right away, matching the e2e spec's
 * expectation that adding a task/assessment never requires entering edit
 * mode first) — it creates a new, independent row, which isn't "editing"
 * an existing one. Only EXISTING rows are staged: once `editing` is true
 * they become inline-editable and gain a Remove button, and those changes
 * only commit on the dialog's outer Save (or discard on Cancel). Add still
 * asks type-first-then-details (Ayman's exact ordering, unchanged from the
 * original build) — a UX property of the ADD flow itself, unrelated to
 * whether existing rows are currently staged for edit.
 */
export function ClassAssessments({
  assessments,
  editing,
  todayStr,
  onAdd,
  onUpdate,
  onRemove,
}: {
  assessments: ClassAssessment[];
  editing: boolean;
  /** Reference year for formatShortDate — never derive it from a raw Date (AGENTS.md). */
  todayStr: string;
  onAdd: (input: { name: string; type: AssessmentType; date: string }) => void;
  onUpdate: (id: string, patch: Partial<{ name: string; type: AssessmentType; date: string }>) => void;
  onRemove: (id: string) => void;
}) {
  const [addStep, setAddStep] = useState<"closed" | "type" | "details">("closed");
  const [pendingType, setPendingType] = useState<AssessmentType | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  function openAdd() {
    setAddStep("type");
    setPendingType(null);
    setName("");
    setDate("");
  }

  function chooseType(type: AssessmentType) {
    setPendingType(type);
    setAddStep("details");
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingType || !name.trim() || !date) return;
    onAdd({ name: name.trim(), type: pendingType, date });
    setAddStep("closed");
  }

  const hasLinkedTask = assessments.some((a) => a.task_id !== null);

  // R28: rank by score (date as tiebreak) among items whose confidence actually supports
  // a rank claim; group `insufficient`-confidence items at the bottom, ordered by date
  // among themselves (their own score isn't comparable to anything). Sorts the FULL list,
  // never a date-sorted-then-truncated set with risk only reordering within it — that was
  // College-app's own DeadlineRadar bug (8d77e73).
  //
  // The MIXED case below (some but not all items insufficient) cannot happen on this
  // surface today, and it is worth writing down rather than someone finding it "dead" and
  // deleting it. `computeAssignmentRisk` can only exclude three factors — difficulty,
  // knowledgeGap, gradeHeadroom — and all three read from CLASS-level columns
  // (classes.difficulty_rating/confidence_rating/target_grade_pct), never per-assessment
  // ones. `weightPct` is the only per-assessment risk input, and it's required, never
  // excludable (build-assessment-risk-input.ts defaults an unknown weight to 0 rather than
  // excluding it). So every assessment in one class shares the same missing set and
  // therefore the same confidence — this component only ever renders per-class
  // (class-detail-dialog.tsx) — meaning "mixed" is structurally impossible until either a
  // per-assessment factor becomes excludable (most plausibly weightPct, if the engine ever
  // treats an unknown weight as missing rather than requiring a number) or this component
  // starts rendering assessments from more than one class at once. Kept correct and
  // tested anyway: the reachable case (all insufficient) is the trivial one, and the day
  // this stops being unreachable is exactly the day a silent gap here would matter most.
  const displayAssessments = [...assessments].sort((a, b) => {
    const aRanked = a.risk.confidence !== "insufficient";
    const bRanked = b.risk.confidence !== "insufficient";
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked) return b.risk.score - a.risk.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  const insufficientCount = assessments.filter((a) => a.risk.confidence === "insufficient").length;
  const allInsufficient = assessments.length > 0 && insufficientCount === assessments.length;
  const firstInsufficientId = allInsufficient
    ? null // the whole-list caption covers this state; the per-group prompt would be redundant.
    : (displayAssessments.find((a) => a.risk.confidence === "insufficient")?.id ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Assessments</h3>
        {/* Add is available regardless of `editing` — it creates a new,
            independent row rather than modifying an existing one, so it's
            not part of the staged edit/Save/Cancel contract (same reasoning
            as the task wizard: only per-row edit/remove of EXISTING items
            is staged). Commits immediately via onAdd. */}
        <Button type="button" variant="outline" size="sm" onClick={openAdd}>
          Add assessment
        </Button>
      </div>

      {allInsufficient && <p className="text-xs text-muted-foreground">{ALL_INSUFFICIENT_CAPTION}</p>}

      {assessments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No assessments yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {/* Fixed column widths (name flexes, type/date/confidence/actions
              don't) so a long name never pushes the date into the Remove
              button — the exact collision Ayman's screenshot showed in the
              old <table>. */}
          <div className={cn("grid gap-3 px-1 text-xs text-muted-foreground", ROW_GRID)}>
            <span>Name</span>
            <span>Type</span>
            <span>Date</span>
            <span>Conf.</span>
            <span aria-hidden />
          </div>
          {displayAssessments.map((a) => (
            <Fragment key={a.id}>
              {a.id === firstInsufficientId && (
                <p key={`${a.id}-prompt`} className="px-1 text-xs text-muted-foreground">
                  {INSUFFICIENT_GROUP_PROMPT}
                </p>
              )}
              {editing ? (
                <div
                  key={a.id}
                  data-testid={`assessment-row-${a.id}`}
                  className={cn("grid items-center gap-3 rounded-lg border border-border/40 px-2 py-1.5", ROW_GRID)}
                >
                  <Input
                    value={a.name}
                    onChange={(e) => onUpdate(a.id, { name: e.target.value })}
                    aria-label={`Name for ${a.name || "new assessment"}`}
                    className="h-8"
                  />
                  <select
                    value={a.type}
                    onChange={(e) => onUpdate(a.id, { type: e.target.value as AssessmentType })}
                    aria-label={`Type for ${a.name || "new assessment"}`}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                  >
                    {(Object.keys(TYPE_LABEL) as AssessmentType[]).map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABEL[type]}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="date"
                    value={a.date}
                    onChange={(e) => onUpdate(a.id, { date: e.target.value })}
                    aria-label={`Date for ${a.name || "new assessment"}`}
                    className="h-8 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">{CONFIDENCE_LABEL[a.risk.confidence]}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(a.id)}
                    aria-label={`Remove ${a.name || "this assessment"}`}
                    className="justify-self-end rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ) : (
                <div
                  key={a.id}
                  data-testid={`assessment-row-${a.id}`}
                  className={cn(
                    "grid items-center gap-3 border-t border-border/40 px-1 py-1.5 text-sm first:border-t-0",
                    ROW_GRID
                  )}
                >
                  <span className="truncate">{a.name}</span>
                  <span className={cn("truncate text-xs font-medium", TYPE_COLOR[a.type])}>{TYPE_SHORT_LABEL[a.type]}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatShortDate(a.date, todayStr)}
                  </span>
                  <span className="text-xs text-muted-foreground">{CONFIDENCE_LABEL[a.risk.confidence]}</span>
                  <span aria-hidden />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}

      {editing && hasLinkedTask && (
        <p className="text-xs text-muted-foreground">Removing an assessment also removes its linked task.</p>
      )}

      {/* Inline, not a nested Dialog — this dialog already sits inside
          class-detail-dialog.tsx's own Dialog, and a Dialog-in-Dialog can
          leave the outer one `aria-hidden` after the inner one closes
          (Radix). habit-editor-dialog.tsx hit this same shape and solved it
          the same way: a plain view state instead of nesting. */}
      {addStep === "type" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Assessment type</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TYPE_LABEL) as AssessmentType[]).map((type) => (
              <Button key={type} type="button" variant="outline" size="sm" onClick={() => chooseType(type)}>
                {TYPE_LABEL[type]}
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAddStep("closed")}>
            Cancel
          </Button>
        </div>
      )}
      {addStep === "details" && pendingType && (
        <form onSubmit={submitDetails} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">{TYPE_LABEL[pendingType]} details</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAddStep("closed")}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || !date}>
              Add
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
