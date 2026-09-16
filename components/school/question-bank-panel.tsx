"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Pencil, RotateCcw, Sparkles, Trash2, User } from "lucide-react";
import { createQuestion, updateQuestion, setQuestionActive, type QuestionOrigin } from "@/app/(app)/school/question-actions";
import {
  draftQuestionsFromNotes,
  draftQuestionsFromTranscript,
  type QuestionDraftOutcome,
  type TranscriptQuestionDraftOutcome,
} from "@/app/(app)/school/question-draft-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ClassShareSection } from "@/components/school/class-share-section";
import { PublicQuestionBankDrill } from "@/components/school/public-question-bank-drill";

export type QuestionBankQuestion = {
  id: string;
  prompt: string;
  answer: string;
  topic: string | null;
  sourceAnchor: string | null;
  sourceSkipped: boolean;
  origin: QuestionOrigin;
  active: boolean;
};

const ORIGIN_LABEL: Record<QuestionOrigin, string> = { self: "Self", ai: "AI", missed: "Missed" };
const ORIGIN_BADGE_VARIANT: Record<QuestionOrigin, BadgeVariant> = { self: "neutral", ai: "info", missed: "warning" };
const ORIGIN_ICON: Record<QuestionOrigin, typeof User> = { self: User, ai: Sparkles, missed: HelpCircle };

type Draft = {
  prompt: string;
  answer: string;
  topic: string;
  sourceAnchor: string;
  sourceSkipped: boolean;
};

function emptyDraft(): Draft {
  return { prompt: "", answer: "", topic: "", sourceAnchor: "", sourceSkipped: false };
}

function draftFromQuestion(q: QuestionBankQuestion): Draft {
  return {
    prompt: q.prompt,
    answer: q.answer,
    topic: q.topic ?? "",
    sourceAnchor: q.sourceAnchor ?? "",
    sourceSkipped: q.sourceSkipped,
  };
}

/** One AI-drafted row awaiting review (Phase 1 #23) — no DB id yet, keyed
 * locally so each row can be edited/discarded/added independently. Every
 * field is pre-filled from the model's own draft but stays fully editable,
 * same discipline the manual-entry `Draft` above already has -- nothing
 * here is ever inserted without going through this same review shape. */
type AiDraftRow = {
  key: string;
  prompt: string;
  answer: string;
  topic: string;
  sourceAnchor: string;
  sourceSkipped: boolean;
  /** Set only when THIS row's own add attempt failed -- never clears the
   * other rows, and never silently drops this one's edits (same "failed
   * submit stays visible, answer preserved" rule #26's gradeQuestion uses). */
  error: string | null;
};

let nextAiDraftKey = 0;

function draftRowFromAiDraft(d: { prompt: string; answer: string; topic: string | null; sourceSnippet: string | null }): AiDraftRow {
  return {
    key: `ai-${nextAiDraftKey++}`,
    prompt: d.prompt,
    answer: d.answer,
    topic: d.topic ?? "",
    // The model's own verbatim quote pre-fills the source-anchor field --
    // still fully editable, still subject to the anchor-or-skip rule below.
    // No snippet means no candidate anchor, so this defaults to skipped
    // rather than blocking every draft on a field the model didn't supply.
    sourceAnchor: d.sourceSnippet ?? "",
    sourceSkipped: !d.sourceSnippet,
    error: null,
  };
}

const DRAFT_OUTCOME_MESSAGE: Partial<Record<QuestionDraftOutcome["status"], string>> = {
  no_key: "Add an API key in Settings to draft questions automatically, or add them manually below.",
  unavailable: "AI drafting isn't available right now — try again shortly, or add questions manually below.",
  parse_failed: "Couldn't make sense of the draft result — try again, or add a question manually.",
};

/** P3-16 — same messages, plus "not_ready" (the picked transcript isn't
 * `completed` — can happen if it was still processing when the picker
 * opened and finished/failed in between) and "error" (the transcript
 * lookup itself failed — a DB error, never thrown from the Server Action). */
const TRANSCRIPT_DRAFT_OUTCOME_MESSAGE: Partial<Record<TranscriptQuestionDraftOutcome["status"] | "not_ready" | "error", string>> = {
  no_key: "Add an API key in Settings to draft questions automatically, or add them manually below.",
  unavailable: "AI drafting isn't available right now — try again shortly, or add questions manually below.",
  parse_failed: "Couldn't make sense of the draft result — try again, or add a question manually.",
  not_ready: "This transcript isn't ready yet — try again once it finishes.",
  error: "Couldn't check that transcript — try again, or add a question manually.",
};

/** P3-16 — the lean subset of a lecture recording this panel actually
 * needs (filename to label the picker, id to request drafting, and status
 * to filter to only completed transcripts) rather than the full
 * LectureRecording shape lecture-panel.tsx owns. */
export type QuestionBankLecture = { id: string; originalFilename: string; transcriptStatus: "none" | "queued" | "processing" | "completed" | "failed" };

/**
 * Per-course question bank (Phase 1 #20/#21/#22/#23) — manual create, edit,
 * retire (never a hard delete, see lib/school/questions-core.ts's own
 * header), and AI-drafted questions from pasted notes. Self-contained and
 * independently committing, same philosophy as SyllabusPanel one section
 * over: every action calls its Server Action directly and refreshes,
 * rather than staging into class-detail-dialog's outer Save — a question
 * isn't part of "this class's identity fields," it has its own lifecycle
 * the same way an assessment's Add already does.
 *
 * #23's whole discipline: pasted notes -> gatewayChat (question-draft-
 * generation.ts) -> a REVIEW list, exactly parallel to SyllabusReviewPanel
 * -- nothing lands in the bank until the user explicitly adds it, and
 * every field is editable first. `origin: "ai"` is passed explicitly on
 * add (createQuestionCore defaults to "self" otherwise). A no-key/
 * unavailable/parse_failed outcome is a real, actionable state, never a
 * dead end — manual entry ("Add question") is always reachable by
 * cancelling out of the AI flow.
 *
 * Confidence self-rating (#26) lives in the retrieval session overlay, not
 * here — this panel only ever manages the bank itself.
 */
export function QuestionBankPanel({
  classId,
  questions,
  lectures = [],
}: {
  classId: string;
  questions: QuestionBankQuestion[];
  /** P3-16 — this class's lecture recordings (any transcript status); the
   * picker filters to `completed` itself, so callers can pass the same
   * array LecturePanel already receives with no filtering of their own. */
  lectures?: QuestionBankLecture[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDrafting, startDrafting] = useTransition();
  const [showRetired, setShowRetired] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const [formMode, setFormMode] = useState<"closed" | "add" | { editingId: string } | "ai_paste" | "ai_review" | "transcript_pick">("closed");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [notesText, setNotesText] = useState("");
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiDrafts, setAiDrafts] = useState<AiDraftRow[]>([]);

  const completedTranscripts = useMemo(() => lectures.filter((l) => l.transcriptStatus === "completed"), [lectures]);

  const active = useMemo(() => questions.filter((q) => q.active), [questions]);
  const retired = useMemo(() => questions.filter((q) => !q.active), [questions]);

  function openAdd() {
    setDraft(emptyDraft());
    setError(null);
    setFormMode("add");
  }

  function openEdit(q: QuestionBankQuestion) {
    setDraft(draftFromQuestion(q));
    setError(null);
    setFormMode({ editingId: q.id });
  }

  function closeForm() {
    setFormMode("closed");
    setError(null);
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (formMode === "closed" || formMode === "ai_paste" || formMode === "ai_review" || formMode === "transcript_pick") return;
    setError(null);
    startTransition(async () => {
      try {
        if (formMode === "add") {
          await createQuestion({
            classId,
            prompt: draft.prompt,
            answer: draft.answer,
            topic: draft.topic || null,
            sourceAnchor: draft.sourceAnchor || null,
            sourceSkipped: draft.sourceSkipped,
          });
        } else {
          await updateQuestion(formMode.editingId, {
            prompt: draft.prompt,
            answer: draft.answer,
            topic: draft.topic || null,
            sourceAnchor: draft.sourceAnchor || null,
            sourceSkipped: draft.sourceSkipped,
          });
        }
        setFormMode("closed");
        router.refresh();
      } catch (err) {
        // Stay open with the draft intact — never silently drop what was typed.
        setError(err instanceof Error ? err.message : "Couldn't save — try again");
      }
    });
  }

  function toggleActive(q: QuestionBankQuestion) {
    startTransition(async () => {
      await setQuestionActive(q.id, !q.active);
      router.refresh();
    });
  }

  function openAiPaste() {
    setNotesText("");
    setAiMessage(null);
    setError(null);
    setFormMode("ai_paste");
  }

  function closeAiFlow() {
    setFormMode("closed");
    setAiMessage(null);
    setAiDrafts([]);
  }

  function openTranscriptPick() {
    setAiMessage(null);
    setError(null);
    setFormMode("transcript_pick");
  }

  /** P3-16 — same review-list contract as submitNotes: nothing lands in the
   * bank until the user reviews and explicitly adds it, through the exact
   * same aiDrafts/AiDraftRow machinery notes-based drafting already uses. */
  function submitTranscriptDraft(recordingId: string) {
    setAiMessage(null);
    startDrafting(async () => {
      const result = await draftQuestionsFromTranscript(recordingId);
      if (result.status !== "drafted") {
        setAiMessage(TRANSCRIPT_DRAFT_OUTCOME_MESSAGE[result.status] ?? "Drafting didn't work — try again or add a question manually.");
        return;
      }
      if (result.drafts.length === 0) {
        setAiMessage("No questions could be drafted from that transcript — try adding one manually.");
        return;
      }
      setAiDrafts(result.drafts.map(draftRowFromAiDraft));
      setAiMessage(result.partial ? "This transcript was long, so only part of it was read. Check for anything missing." : null);
      setFormMode("ai_review");
    });
  }

  function submitNotes(e: React.FormEvent) {
    e.preventDefault();
    const text = notesText.trim();
    if (!text) return;
    setAiMessage(null);
    startDrafting(async () => {
      const result = await draftQuestionsFromNotes(text);
      if (result.status !== "drafted") {
        // Notes stay in the textarea -- never silently dropped, same as
        // every other "failed submit keeps what was typed" rule in this
        // codebase.
        setAiMessage(DRAFT_OUTCOME_MESSAGE[result.status] ?? "Drafting didn't work — try again or add a question manually.");
        return;
      }
      if (result.drafts.length === 0) {
        setAiMessage("No questions could be drafted from that text — try adding more detail, or add a question manually.");
        return;
      }
      setAiDrafts(result.drafts.map(draftRowFromAiDraft));
      setAiMessage(
        result.truncated
          ? "These notes were long, so only the first part was read. Check for anything missing."
          : null
      );
      setFormMode("ai_review");
    });
  }

  function updateAiDraft(key: string, patch: Partial<AiDraftRow>) {
    setAiDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch, error: null } : d)));
  }

  function discardAiDraft(key: string) {
    setAiDrafts((prev) => {
      const next = prev.filter((d) => d.key !== key);
      if (next.length === 0) setFormMode("closed");
      return next;
    });
  }

  /** One row's own add attempt. A failure sets ONLY this row's error and
   * leaves it (and every other row) exactly as it was -- never a partial
   * silent drop, never losing sibling rows over one bad anchor/prompt. */
  async function addOneAiDraft(row: AiDraftRow): Promise<boolean> {
    try {
      await createQuestion({
        classId,
        prompt: row.prompt,
        answer: row.answer,
        topic: row.topic || null,
        sourceAnchor: row.sourceAnchor || null,
        sourceSkipped: row.sourceSkipped,
        origin: "ai",
      });
      return true;
    } catch (err) {
      setAiDrafts((prev) =>
        prev.map((d) => (d.key === row.key ? { ...d, error: err instanceof Error ? err.message : "Couldn't add — try again" } : d))
      );
      return false;
    }
  }

  function addAiDraft(key: string) {
    const row = aiDrafts.find((d) => d.key === key);
    if (!row) return;
    startTransition(async () => {
      const ok = await addOneAiDraft(row);
      if (ok) {
        setAiDrafts((prev) => {
          const next = prev.filter((d) => d.key !== key);
          if (next.length === 0) setFormMode("closed");
          return next;
        });
        router.refresh();
      }
    });
  }

  function addAllAiDrafts() {
    startTransition(async () => {
      const rows = aiDrafts;
      const succeededKeys = new Set<string>();
      for (const row of rows) {
        if (await addOneAiDraft(row)) succeededKeys.add(row.key);
      }
      setAiDrafts((prev) => {
        const next = prev.filter((d) => !succeededKeys.has(d.key));
        if (next.length === 0) setFormMode("closed");
        return next;
      });
      if (succeededKeys.size > 0) router.refresh();
    });
  }

  const visible = showRetired ? [...active, ...retired] : active;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Question bank</h3>
        <div className="flex items-center gap-2">
          {retired.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowRetired((v) => !v)}>
              {showRetired ? "Hide retired" : `Show retired (${retired.length})`}
            </Button>
          )}
          {/* "Add question" is suppressed when the empty state below is
              about to render its own Add action -- otherwise two
              identically-labeled controls would sit on screen at once.
              "Draft with AI" has no empty-state equivalent (EmptyState only
              supports one action), so it stays visible in both cases --
              exactly when there is nothing to draft is when drafting is
              most useful. */}
          {formMode === "closed" && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={openAiPaste}>
                <Sparkles className="size-3.5" aria-hidden /> Draft with AI
              </Button>
              {/* P3-16 — only offered once at least one recording actually has
                  a completed transcript to draft from; "no completed
                  transcripts yet" is the normal starting state, not an error,
                  so this button simply doesn't appear rather than appearing
                  disabled with an explanation. */}
              {completedTranscripts.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={openTranscriptPick}>
                  <Sparkles className="size-3.5" aria-hidden /> Draft from transcript
                </Button>
              )}
              {visible.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={openAdd}>
                  Add question
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <ClassShareSection classId={classId} />

      {active.length > 0 && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setDrillOpen((v) => !v)}>
          {drillOpen ? "Hide drill" : "Drill this bank"}
        </Button>
      )}
      {drillOpen && (
        <PublicQuestionBankDrill
          questions={active.map((q) => ({ prompt: q.prompt, answer: q.answer, topic: q.topic }))}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {(formMode === "add" || typeof formMode === "object") && (
        <form onSubmit={submitForm} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">{formMode === "add" ? "New question" : "Edit question"}</p>
          <Input
            value={draft.prompt}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            placeholder="Prompt"
            autoFocus
          />
          <Input
            value={draft.answer}
            onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))}
            placeholder="Answer"
          />
          <Input
            value={draft.topic}
            onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
            placeholder="Topic (optional)"
          />
          <div className="flex flex-col gap-2">
            <Input
              value={draft.sourceAnchor}
              onChange={(e) => setDraft((d) => ({ ...d, sourceAnchor: e.target.value }))}
              placeholder="Source (e.g. Ch. 3, p.42)"
              disabled={draft.sourceSkipped}
            />
            <Label className="text-xs font-normal text-muted-foreground">
              <Switch
                size="sm"
                checked={draft.sourceSkipped}
                onCheckedChange={(checked) => setDraft((d) => ({ ...d, sourceSkipped: checked === true, sourceAnchor: checked ? "" : d.sourceAnchor }))}
              />
              No specific source for this one
            </Label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {formMode === "add" ? "Add" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {formMode === "ai_paste" && (
        <form onSubmit={submitNotes} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Paste your notes</p>
          <textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Paste lecture notes, a reading, or a summary — questions are drafted from this text alone."
            rows={8}
            maxLength={20_000}
            autoFocus
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {aiMessage && <p className="text-xs text-accent-warning">{aiMessage}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isDrafting || !notesText.trim()}>
              {isDrafting ? "Drafting…" : "Draft questions"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isDrafting} onClick={closeAiFlow}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {formMode === "transcript_pick" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Draft from which recording?</p>
          {aiMessage && <p className="text-xs text-accent-warning">{aiMessage}</p>}
          <ul className="flex flex-col gap-1.5">
            {completedTranscripts.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-border/30 p-2">
                <span className="truncate text-sm" title={l.originalFilename}>
                  {l.originalFilename}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDrafting}
                  onClick={() => submitTranscriptDraft(l.id)}
                >
                  {isDrafting ? "Drafting…" : "Draft"}
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="self-start" disabled={isDrafting} onClick={closeAiFlow}>
            Cancel
          </Button>
        </div>
      )}

      {formMode === "ai_review" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
          <h4 className="text-sm font-medium">Review drafted questions</h4>
          <p className="text-xs text-muted-foreground">
            Check each one before adding — nothing is added to the bank until you confirm.
          </p>
          {aiMessage && <p className="text-xs text-accent-warning">{aiMessage}</p>}
          <div className="flex flex-col gap-2">
            {aiDrafts.map((d) => (
              <div key={d.key} className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2">
                <div className="flex items-start gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Input
                      value={d.prompt}
                      onChange={(e) => updateAiDraft(d.key, { prompt: e.target.value })}
                      placeholder="Prompt"
                      aria-label="Prompt"
                    />
                    <Input
                      value={d.answer}
                      onChange={(e) => updateAiDraft(d.key, { answer: e.target.value })}
                      placeholder="Answer"
                      aria-label="Answer"
                    />
                    <Input
                      value={d.topic}
                      onChange={(e) => updateAiDraft(d.key, { topic: e.target.value })}
                      placeholder="Topic (optional)"
                      aria-label="Topic"
                    />
                    <Input
                      value={d.sourceAnchor}
                      onChange={(e) => updateAiDraft(d.key, { sourceAnchor: e.target.value })}
                      placeholder="Source (e.g. Ch. 3, p.42)"
                      aria-label="Source"
                      disabled={d.sourceSkipped}
                    />
                    <Label className="text-xs font-normal text-muted-foreground">
                      <Switch
                        size="sm"
                        checked={d.sourceSkipped}
                        onCheckedChange={(checked) =>
                          updateAiDraft(d.key, { sourceSkipped: checked === true, sourceAnchor: checked ? "" : d.sourceAnchor })
                        }
                      />
                      No specific source for this one
                    </Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => discardAiDraft(d.key)}
                    aria-label="Discard this draft"
                    disabled={isPending}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
                {d.error && <p className="text-xs text-destructive">{d.error}</p>}
                <Button type="button" size="sm" variant="outline" className="self-start" disabled={isPending} onClick={() => addAiDraft(d.key)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={addAllAiDrafts}>
              Add all {aiDrafts.length}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={closeAiFlow}>
              Discard all
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 && formMode === "closed" ? (
        <EmptyState
          icon={HelpCircle}
          message="No questions yet — build this class's retrieval-practice bank as you study."
          action={{ label: "Add question", onClick: openAdd }}
        />
      ) : (
        <div className="divide-y divide-border/40">
          {visible.map((q) => {
            const Icon = ORIGIN_ICON[q.origin];
            return (
              <ListRow
                key={q.id}
                className={q.active ? undefined : "opacity-60"}
                leading={<IconChip icon={Icon} accent="school" size="sm" />}
                label={q.prompt}
                meta={q.topic ?? undefined}
                trailing={
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={ORIGIN_BADGE_VARIANT[q.origin]}>{ORIGIN_LABEL[q.origin]}</Badge>
                    <button
                      type="button"
                      aria-label={q.active ? `Retire ${q.prompt}` : `Reactivate ${q.prompt}`}
                      onClick={() => toggleActive(q)}
                      disabled={isPending}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    >
                      {q.active ? <Trash2 className="size-3.5" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                    </button>
                    {q.active && (
                      <button
                        type="button"
                        aria-label={`Edit ${q.prompt}`}
                        onClick={() => openEdit(q)}
                        disabled={isPending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
