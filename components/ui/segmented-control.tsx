import Link from "next/link";
import { cn } from "@/lib/utils";

type LinkOption = { label: string; href: string; active: boolean };
type ValueOption = { label: string; value: string; active: boolean };

const ITEM_CLASS = (active: boolean) =>
  cn(
    "rounded-full px-3 py-1 text-sm transition-colors",
    active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
  );

// Two modes: a set of route links (search-param-driven UI state, no client
// JS needed — the existing Insights Day/Week toggle's pattern) or a set of
// values reported via onSelect (genuine client-side state).
export function SegmentedControl(
  props:
    | { options: LinkOption[]; onSelect?: never }
    | { options: ValueOption[]; onSelect: (value: string) => void }
) {
  if (props.onSelect) {
    const onSelect = props.onSelect;
    return (
      <div className="flex gap-2 text-sm">
        {props.options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-current={option.active ? "true" : undefined}
            onClick={() => onSelect(option.value)}
            className={ITEM_CLASS(option.active)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2 text-sm">
      {props.options.map((option) => (
        <Link
          key={option.label}
          href={option.href}
          aria-current={option.active ? "true" : undefined}
          className={ITEM_CLASS(option.active)}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
