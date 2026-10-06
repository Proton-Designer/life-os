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
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:gap-y-4">
      <div className="order-1">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="order-3 w-full min-w-0 sm:order-2 sm:w-auto sm:flex-1 sm:basis-[28rem]">{children}</div>}
      {actions && <div className="order-2 flex items-center gap-2 sm:order-3">{actions}</div>}
    </div>
  );
}
