"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addClassAssessment, deleteClassAssessment, type AssessmentType } from "@/app/(app)/school/class-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ClassAssessment = {
  id: string;
  name: string;
  type: AssessmentType;
  date: string;
  task_id: string | null;
};

const TYPE_LABEL: Record<AssessmentType, string> = {
  quiz: "Quiz",
  exam: "Exam",
  midterm_final: "Midterm/Final",
};

/**
 * Left half of the expanded class view (item 6c, verbatim spec): a list
 * (name, type, date) plus an Add button that opens a popup asking for
 * **type first**, then name+date — Ayman's exact ordering, not a single
 * combined form. Adding writes through `addClassAssessment`, which also
 * creates the linked task (Ruling R5) — this component never touches
 * `tasks` directly.
 *
 * A null `task_id` (the task was deleted independently through the main
 * list — schema comment in migration 048) renders with no "view task"
 * affordance; it's not an error state, just means the checklist item is
 * gone while the academic record survives.
 */
export function ClassAssessments({ classId, initialAssessments }: { classId: string; initialAssessments: ClassAssessment[] }) {
  const router = useRouter();
  const [assessments, setAssessments] = useState(initialAssessments);
  const [addStep, setAddStep] = useState<"closed" | "type" | "details">("closed");
  const [pendingType, setPendingType] = useState<AssessmentType | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [isPending, startTransition] = useTransition();

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
    const trimmedName = name.trim();
    startTransition(async () => {
      await addClassAssessment(classId, trimmedName, pendingType, date);
      setAssessments((prev) =>
        [...prev, { id: `pending-${Date.now()}`, name: trimmedName, type: pendingType, date, task_id: null }].sort((a, b) =>
          a.date < b.date ? -1 : 1
        )
      );
      setAddStep("closed");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteClassAssessment(id);
      setAssessments((prev) => prev.filter((a) => a.id !== id));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Assessments</h3>
        <Button type="button" variant="outline" size="sm" onClick={openAdd}>
          Add
        </Button>
      </div>

      {assessments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No assessments yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 font-normal">Name</th>
              <th className="pb-1 font-normal">Type</th>
              <th className="pb-1 font-normal">Date</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {assessments.map((a) => (
              <tr key={a.id} className="border-t border-border/40">
                <td className="py-1.5">{a.name}</td>
                <td className="py-1.5 text-muted-foreground">{TYPE_LABEL[a.type]}</td>
                <td className="py-1.5 font-mono text-xs tabular-nums">{a.date}</td>
                <td className="py-1.5 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => remove(a.id)}
                    aria-label={`Remove ${a.name}`}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={addStep !== "closed"} onOpenChange={(next) => !next && setAddStep("closed")}>
        <DialogContent className="sm:max-w-sm">
          {addStep === "type" ? (
            <>
              <DialogHeader>
                <DialogTitle>Assessment type</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                {(Object.keys(TYPE_LABEL) as AssessmentType[]).map((type) => (
                  <Button key={type} type="button" variant="outline" onClick={() => chooseType(type)}>
                    {TYPE_LABEL[type]}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            pendingType && (
              <>
                <DialogHeader>
                  <DialogTitle>{TYPE_LABEL[pendingType]} details</DialogTitle>
                </DialogHeader>
                <form onSubmit={submitDetails} className="flex flex-col gap-3">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  <Button type="submit" disabled={isPending || !name.trim() || !date}>
                    Add
                  </Button>
                </form>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
