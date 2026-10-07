import { cn } from "@/lib/utils";

/**
 * The <li> every Today / task row sits in: it carries the EXIT motion (a 1fr -> 0fr grid row collapses the height without
 * measuring it, together with a fade: no layout jump) and the focus treatment of Home's Today list.
 *   focus  the one row to do right now: full brightness, a subtle tint + ring, a tiny "Focus" label.
 *   dim    every other pending row in that list: slightly dimmed, back to full on hover / focus-within.
 */
export function RowShell({
  exiting = false,
  emphasis,
  className,
  children,
  ...rest
}: {
  exiting?: boolean;
  emphasis?: "focus" | "dim";
  className?: string;
  children: React.ReactNode;
} & Omit<React.LiHTMLAttributes<HTMLLIElement>, "className" | "children">) {
  return (
    <li
      {...rest}
      data-exiting={exiting ? "true" : undefined}
      data-emphasis={emphasis}
      className={cn(
        "grid min-w-0 transition-[grid-template-rows,opacity] duration-200 ease-out",
        exiting ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
        !exiting && emphasis === "dim" && "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100",
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-col", exiting && "min-h-0 overflow-hidden", emphasis === "focus" && "rounded-lg bg-primary/5 ring-1 ring-primary/25")}>
        {emphasis === "focus" ? <span className="px-3 pt-1.5 text-[10px] font-semibold tracking-wide text-primary uppercase">Focus</span> : null}
        {children}
      </div>
    </li>
  );
}
