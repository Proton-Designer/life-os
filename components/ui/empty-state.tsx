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
  action?: EmptyStateAction;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Icon className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      {action &&
        (action.href ? (
          <Button asChild size="sm" variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}
