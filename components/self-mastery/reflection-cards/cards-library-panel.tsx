"use client";

import { useState, useTransition } from "react";
import { Plus, X, Layers } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { createReflectionCard, archiveReflectionCard } from "@/app/(app)/personal/reflection-cards-actions";
import { REFLECTION_CARD_KINDS, type ReflectionCard, type ReflectionCardKind } from "@/lib/reflection-cards/types";

const KIND_LABEL: Record<ReflectionCardKind, string> = {
  goal: "Goal",
  motivation: "Motivation",
  thought_habit: "Thought-Habit",
  trait: "Trait",
};

const TEXTAREA_CLASS =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/**
 * P3-05's cards library UI -- create/list/archive across the four kinds
 * (Goal, Motivation, Thought-Habit, Trait). Mounted from
 * self-mastery-library.tsx, gated server-side there on the `cards_library`
 * opt-in flag (this component itself never re-checks the flag -- it isn't
 * rendered at all when it's off, the same posture UploadBookDialog's own
 * caller already uses for canUpload).
 *
 * State managed OPTIMISTICALLY and entirely client-side, not via
 * router.refresh()/revalidatePath: the Server Actions this calls
 * (reflection-cards-actions.ts) already revalidatePath("/self-mastery"),
 * but this component also mounts at /personal/self_mastery (domains mode)
 * -- a path that revalidate call was never told about. Rather than fix
 * that mismatch here (out of scope), this panel just doesn't depend on it:
 * create/archive update local state directly from the action's own return
 * value, same optimistic-with-rollback shape as OptInFeaturesSettings.
 */
export function CardsLibraryPanel({ initialCards }: { initialCards: ReflectionCard[] }) {
  const [cards, setCards] = useState<ReflectionCard[]>(initialCards);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<ReflectionCardKind>("goal");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setContent("");
    setKind("goal");
    setDialogOpen(true);
  }

  function handleCreate() {
    const trimmed = content.trim();
    if (!trimmed) {
      setError("A card needs some content.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createReflectionCard(kind, trimmed);
      if (!result.ok || !result.card) {
        setError(result.message);
        return;
      }
      setCards((prev) => [result.card as ReflectionCard, ...prev]);
      setDialogOpen(false);
    });
  }

  function handleArchive(cardId: string) {
    setArchivingId(cardId);
    const previous = cards;
    setCards((prev) => prev.filter((c) => c.id !== cardId)); // optimistic
    startTransition(async () => {
      const result = await archiveReflectionCard(cardId);
      if (!result.ok) setCards(previous); // rollback
      setArchivingId(null);
    });
  }

  return (
    <Panel
      title="Cards library"
      controls={
        cards.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={openDialog} className="gap-1.5">
            <Plus className="size-4" />
            Add a card
          </Button>
        ) : null
      }
    >
      {cards.length === 0 ? (
        <EmptyState
          icon={Layers}
          message="No cards yet. A card is a short Goal, Motivation, Thought-Habit, or Trait reminder the End-of-Hour ritual rotates through."
          action={{ label: "Add a card", onClick: openDialog }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.id} className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABEL[card.kind]}
                </span>
                <button
                  type="button"
                  aria-label="Archive card"
                  onClick={() => handleArchive(card.id)}
                  disabled={archivingId === card.id}
                  className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <p className="text-sm text-foreground">{card.content}</p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a card</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {REFLECTION_CARD_KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={kind === k ? "default" : "outline"}
                  onClick={() => setKind(k)}
                >
                  {KIND_LABEL[k]}
                </Button>
              ))}
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What do you want to be reminded of?"
              rows={3}
              className={TEXTAREA_CLASS}
              autoFocus
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" disabled={isPending || !content.trim()} onClick={handleCreate}>
              {isPending ? "Adding…" : "Add card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
