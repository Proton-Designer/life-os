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
  /** Optional middle region between the title and the actions (Home puts This Week's Focus here). */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap justify-between gap-x-4 gap-y-3 sm:gap-y-4", children ? "items-center" : "items-start")}>
      <div className="order-1">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="order-3 w-full min-w-0 2xl:order-2 2xl:w-auto 2xl:flex-1">{children}</div>}
      {actions && <div className="order-2 flex items-center gap-2 2xl:order-3">{actions}</div>}
    </div>
  );
}
