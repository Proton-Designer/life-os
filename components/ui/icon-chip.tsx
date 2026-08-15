import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";

const CHIP_SIZE_CLASS = {
  sm: "size-8",
  md: "size-9",
  lg: "size-10",
} as const;

const ICON_SIZE_CLASS = {
  sm: "size-4",
  md: "size-4",
  lg: "size-5",
} as const;

export function IconChip({
  icon: Icon,
  accent,
  size = "md",
  className,
  ...props
}: {
  icon: LucideIcon;
  accent: AccentToken;
  size?: keyof typeof CHIP_SIZE_CLASS;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const colorVar = ACCENT_VAR[accent];

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        CHIP_SIZE_CLASS[size],
        className
      )}
      style={{
        backgroundColor: `color-mix(in oklch, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
      }}
      {...props}
    >
      <Icon className={ICON_SIZE_CLASS[size]} />
    </div>
  );
}
