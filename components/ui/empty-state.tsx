import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmptyStateAction = {
  label: string;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

export function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: LucideIcon;
  message: string;
  // Required, not optional — "an empty screen is an invitation to act" per
  // spec, enforced at the type level the same way KpiCard's caption is.
  // A genuinely action-less empty state is a deliberate exception to raise
  // with the lead, not a default this component makes available.
  action: EmptyStateAction;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Icon className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      {action.href ? (
        <Button asChild size="sm" variant="outline">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
