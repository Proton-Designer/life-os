import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Optional middle region between the title and the actions (Home puts This Week's Focus here): inline from md up, a full-width row under the title on a phone. */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap justify-between gap-x-4 gap-y-3 sm:gap-y-4", children ? "items-center md:flex-nowrap" : "items-start")}>
      <div className={cn("order-1", children && "md:shrink-0")}>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="order-3 w-full min-w-0 md:order-2 md:w-auto md:flex-1">{children}</div>}
      {actions && <div className="order-2 flex items-center gap-2 md:order-3 md:shrink-0">{actions}</div>}
    </div>
  );
}
