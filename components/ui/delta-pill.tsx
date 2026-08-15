import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DeltaDirection = "up" | "down" | "flat";

const DIRECTION_CLASS: Record<DeltaDirection, string> = {
  up: "bg-accent-business/15 text-accent-business",
  down: "bg-destructive/15 text-destructive",
  flat: "bg-muted text-muted-foreground",
};

export function DeltaPill({ direction, text }: { direction: DeltaDirection; text: string }) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium",
        DIRECTION_CLASS[direction]
      )}
    >
      {Icon && <Icon className="size-3" />}
      {text}
    </span>
  );
}
