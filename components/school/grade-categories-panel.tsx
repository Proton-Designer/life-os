"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { createGradeCategory, updateGradeCategory, deleteGradeCategory, type GradeCategoryInput } from "@/app/(app)/school/class-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type GradeCategory = { id: string; name: string; weightPct: number; dropLowestN: number; expectedItemCount: number };

type Draft = { name: string; weightPct: string; dropLowestN: string; expectedItemCount: string };

const EMPTY_DRAFT: Draft = { name: "", weightPct: "", dropLowestN: "0", expectedItemCount: "1" };

function toGradeCategoryInput(d: Draft): GradeCategoryInput | null {
  const name = d.name.trim();
  const weightPct = Number(d.weightPct);
  if (!name || !Number.isFinite(weightPct) || weightPct <= 0 || weightPct > 100) return null;
  const dropLowestN = Number(d.dropLowestN);
  const expectedItemCount = Number(d.expectedItemCount);
  return {
    name,
    weightPct,
    dropLowestN: Number.isFinite(dropLowestN) && dropLowestN >= 0 ? dropLowestN : 0,
    expectedItemCount: Number.isFinite(expectedItemCount) && expectedItemCount > 0 ? expectedItemCount : 1,
  };
}

/**
 * Phase 1 #11 — CollegeOS's real weight-category model (migration 152's
 * `grade_categories`), management UI. Schema + a tested engine-adapter
 * capability (`computeClassGrade`'s `categoryDefs` parameter) shipped with
 * zero UI wired to it; this is that wiring.
 *
 * A class with zero categories is unaffected by this panel existing —
 * `computeClassGrade`'s original synthetic-per-assessment treatment stays
 * exactly as it was (see grade-ledger.ts's own header) — so this is purely
 * additive, never a required step before a class's grade computes.
 *
 * Immediate-commit CRUD via its own Server Actions (create/update/delete each
 * write through and `router.refresh()`-free — `revalidatePath` in the action
 * itself is enough since this panel owns no state the parent dialog also
 * stages), same self-contained shape as `question-bank-panel.tsx` and
 * `syllabus-panel.tsx` — not part of class-detail-dialog.tsx's staged
 * edit/Save/Cancel contract for course details.
 */
export function GradeCategoriesPanel({ classId, categories }: { classId: string; categories: GradeCategory[] }) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const weightSum = categories.reduce((sum, c) => sum + c.weightPct, 0);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const input = toGradeCategoryInput(addDraft);
    if (!input) {
      setError("Name and a weight between 0 and 100 are required");
      return;
    }
    setError(null);
    try {
      await createGradeCategory(classId, input);
      setAddDraft(EMPTY_DRAFT);
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add category");
    }
  }

  function startEdit(c: GradeCategory) {
    setEditingId(c.id);
    setEditDraft({
      name: c.name,
      weightPct: c.weightPct.toString(),
      dropLowestN: c.dropLowestN.toString(),
      expectedItemCount: c.expectedItemCount.toString(),
    });
    setError(null);
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const input = toGradeCategoryInput(editDraft);
    if (!input) {
      setError("Name and a weight between 0 and 100 are required");
      return;
    }
    setError(null);
    setPendingId(editingId);
    try {
      await updateGradeCategory(editingId, input);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save category");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setPendingId(id);
    try {
      await deleteGradeCategory(id);
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove category");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Weight categories</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add category"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {categories.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          No categories yet — assessments use their own individual weight until you add one.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {categories.map((c) =>
            editingId === c.id ? (
              <form key={c.id} onSubmit={handleEditSave} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 p-2">
                <Input
                  value={editDraft.name}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Name"
                  aria-label="Category name"
                  className="h-8 w-32"
                  autoFocus
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={editDraft.weightPct}
                  onChange={(e) => setEditDraft((d) => ({ ...d, weightPct: e.target.value }))}
                  placeholder="Wt %"
                  aria-label="Weight percent"
                  className="h-8 w-20"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={editDraft.dropLowestN}
                  onChange={(e) => setEditDraft((d) => ({ ...d, dropLowestN: e.target.value }))}
                  placeholder="Drop lowest"
                  aria-label="Drop lowest N"
                  className="h-8 w-28"
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={editDraft.expectedItemCount}
                  onChange={(e) => setEditDraft((d) => ({ ...d, expectedItemCount: e.target.value }))}
                  placeholder="Expected items"
                  aria-label="Expected item count"
                  className="h-8 w-28"
                />
                <Button type="submit" size="sm" disabled={pendingId === c.id}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div
                key={c.id}
                data-testid={`grade-category-row-${c.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/40 px-2 py-1.5"
              >
                <button type="button" onClick={() => startEdit(c)} className="min-w-0 flex-1 truncate text-left text-sm">
                  {c.name}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    — {c.weightPct}%{c.dropLowestN > 0 && `, drops lowest ${c.dropLowestN}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  disabled={pendingId === c.id}
                  aria-label={`Remove ${c.name} category`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            )
          )}
          {categories.length > 0 && weightSum !== 100 && (
            <p className="text-xs text-muted-foreground">Categories total {weightSum}% — courseGrade.ts flags this non-fatally too.</p>
          )}
        </div>
      )}

      {adding && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 p-2">
          <Input
            value={addDraft.name}
            onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name (e.g. Homework)"
            aria-label="Category name"
            className="h-8 w-36"
            autoFocus
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            value={addDraft.weightPct}
            onChange={(e) => setAddDraft((d) => ({ ...d, weightPct: e.target.value }))}
            placeholder="Wt %"
            aria-label="Weight percent"
            className="h-8 w-20"
          />
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={addDraft.dropLowestN}
            onChange={(e) => setAddDraft((d) => ({ ...d, dropLowestN: e.target.value }))}
            placeholder="Drop lowest"
            aria-label="Drop lowest N"
            className="h-8 w-28"
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={addDraft.expectedItemCount}
            onChange={(e) => setAddDraft((d) => ({ ...d, expectedItemCount: e.target.value }))}
            placeholder="Expected items"
            aria-label="Expected item count"
            className="h-8 w-28"
          />
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
