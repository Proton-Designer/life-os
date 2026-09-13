"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, Pencil, RotateCcw, Sparkles, Trash2, User } from "lucide-react";
import { createQuestion, updateQuestion, setQuestionActive, type QuestionOrigin } from "@/app/(app)/school/question-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";

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

/**
 * Per-course question bank (Phase 1 #20/#21/#22) — manual create, edit, and
 * retire (never a hard delete, see lib/school/questions-core.ts's own
 * header). Self-contained and independently committing, same philosophy as
 * SyllabusPanel one section over: every action calls its Server Action
 * directly and refreshes, rather than staging into class-detail-dialog's
 * outer Save — a question isn't part of "this class's identity fields," it
 * has its own lifecycle the same way an assessment's Add already does.
 *
 * AI-drafted questions (#23) and confidence self-rating (#26) are NOT here
 * — both are blocked on infrastructure this pass doesn't build (the LLM
 * gateway; the FSRS scheduler's question-backed path — see this engineer's
 * own recon report on #24/#25). Origin is still shown and settable to "ai"
 * or "missed" so a hand-entered question converted from a missed exam
 * answer, or drafted by a person from an AI conversation elsewhere, is
 * still recorded honestly (#21's origin tracking, already real at the
 * schema level).
 */
export function QuestionBankPanel({ classId, questions }: { classId: string; questions: QuestionBankQuestion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRetired, setShowRetired] = useState(false);
  const [formMode, setFormMode] = useState<"closed" | "add" | { editingId: string }>("closed");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);

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
    if (formMode === "closed") return;
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
          {/* Suppressed when the empty state below is about to render its
              own Add action -- otherwise two identically-labeled "Add
              question" controls would sit on screen at once. */}
          {formMode === "closed" && visible.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={openAdd}>
              Add question
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {formMode !== "closed" && (
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
