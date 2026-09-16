"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getPageLayout, savePageLayout, type LayoutItem } from "@/app/(app)/page-layout-actions";

/**
 * WIDGET-02 -- the widget manager dialog. Mounted lazily (only while open)
 * by WidgetManagerButton, so a page that never opens it never fetches a
 * layout it doesn't need.
 *
 * DRAFT UNTIL SAVE: `draft` is local component state, fetched fresh on
 * every open (never carried over from a previous session) and thrown away
 * on Cancel/Escape/overlay-click/unmount without ever calling
 * `savePageLayout` -- the page's own rendered layout (read server-side via
 * `getPageLayout` on its own next render) is the only thing that can
 * change what a reload shows, and nothing here touches it until Save.
 *
 * REORDER, TWO WAYS: a real (zero-dependency) native HTML5 drag handle for
 * a mouse, AND always-present Up/Down buttons -- native drag events do not
 * fire on touch by default, so buttons are not a fallback shown only when
 * drag "fails," they are the one reorder path guaranteed to work
 * everywhere (touch, keyboard, mouse) per this task's own acceptance
 * criteria. No new dependency: HTML5 `draggable`/`onDragOver`/`onDrop` are
 * native browser APIs.
 */
export function WidgetManagerDialog({
  domainKey,
  open,
  onOpenChange,
  onSaved,
}: {
  domainKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<LayoutItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    getPageLayout(domainKey)
      .then((items) => {
        if (!cancelled) setDraft([...items].sort((a, b) => a.position - b.position));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load your widget layout. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, domainKey]);

  function move(index: number, direction: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function reorderByDrag(fromIndex: number, toIndex: number) {
    setDraft((prev) => {
      if (!prev || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
  }

  function toggleHidden(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index]!, hidden: !next[index]!.hidden };
      return next;
    });
  }

  function handleSave() {
    if (!draft) return;
    setSaveError(null);
    startTransition(async () => {
      const items = draft.map((item, index) => ({ widgetKey: item.widgetKey, position: index, hidden: item.hidden }));
      const res = await savePageLayout(domainKey, items);
      if (res.ok) {
        onSaved();
        onOpenChange(false);
      } else {
        setSaveError(res.message);
      }
    });
  }

  // Reached from Cancel, Escape, an overlay click, and the dialog's own X --
  // all four are "abandon the draft," never a partial save, so they share
  // one path: discard local state, let the next open re-fetch clean.
  function discardAndClose() {
    setDraft(null);
    setSaveError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : discardAndClose())}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage widgets</DialogTitle>
        </DialogHeader>

        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

        {!loadError && draft === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

        {draft !== null ? (
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {draft.map((item, index) => (
              <li
                key={item.widgetKey}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) reorderByDrag(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-start gap-2 rounded-lg border border-border/40 p-2"
              >
                <GripVertical className="mt-1 size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </div>
                <Switch
                  className="mt-1 shrink-0"
                  aria-label={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                  checked={!item.hidden}
                  onCheckedChange={() => toggleHidden(index)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

        <div className="flex gap-2 pt-2">
          <Button type="button" disabled={isPending || draft === null} onClick={handleSave}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" disabled={isPending} onClick={discardAndClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
