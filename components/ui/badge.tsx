import { cn } from "@/lib/utils";

export type BadgeVariant = "positive" | "negative" | "warning" | "info" | "neutral";

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  positive: "bg-accent-business/15 text-accent-business",
  negative: "bg-destructive/15 text-destructive",
  warning: "bg-accent-deen/15 text-accent-deen",
  info: "bg-accent-info/15 text-accent-info",
  neutral: "bg-muted text-muted-foreground",
};

export function Badge({
  variant = "neutral",
  className,
  children,
  ...props
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        VARIANT_CLASS[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
