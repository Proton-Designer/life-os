"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `onRemove` is a Server Action bound to this one widget's id
 * (`removeWidget.bind(null, widget.id)`, done by the Server Component that
 * renders this button) — never a wrapping arrow function. A bound Server
 * Action reference survives the RSC serialization boundary; a closure does
 * not (AGENTS.md — this exact class of bug shipped twice already, and only
 * surfaces live in the browser, never in `tsc`/`vitest`).
 */
export function McpWidgetRemoveButton({ onRemove }: { onRemove: () => Promise<void> }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Remove widget"
      disabled={isPending}
      onClick={() => startTransition(() => onRemove())}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        isPending && "opacity-50",
      )}
    >
      <X className="size-3.5" />
    </button>
  );
}
