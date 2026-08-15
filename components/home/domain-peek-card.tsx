import Link from "next/link";
import type { PriorityItem } from "@/lib/home/types";

export type PeekDomain = PriorityItem["domain"];

// Co-op has no color token of its own — it shares School's accent, same as
// priority-list.tsx's DOMAIN_ACCENT_CLASS and get-domain-pulse.ts's folded
// fraction.
const ACCENT_VAR: Record<PeekDomain, string> = {
  deen: "--accent-deen",
  business: "--accent-business",
  fitness: "--accent-fitness",
  school: "--accent-school",
  co_op: "--accent-school",
};

const DOMAIN_LABEL: Record<PeekDomain, string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Co-op",
};

function PulseRing({ pct, colorVar }: { pct: number; colorVar: string }) {
  return (
    <div
      className="size-7 shrink-0 rounded-full p-[3px]"
      style={{ background: `conic-gradient(var(${colorVar}) ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }}
    >
      <div className="size-full rounded-full bg-card" />
    </div>
  );
}

export function DomainPeekCard({
  domain,
  href,
  pulse,
  children,
}: {
  domain: PeekDomain;
  href: string;
  pulse: number;
  children: React.ReactNode;
}) {
  const colorVar = ACCENT_VAR[domain];
  const pct = Math.round(pulse * 100);

  return (
    <Link
      href={href}
      data-testid={`domain-peek-card-${domain}`}
      className="flex snap-start flex-col gap-3 rounded-2xl border p-5 transition-colors hover:bg-accent/10 md:min-w-0"
      style={{
        borderColor: `color-mix(in oklch, var(${colorVar}) 25%, transparent)`,
        background: `radial-gradient(ellipse at top left, color-mix(in oklch, var(${colorVar}) 10%, transparent), transparent 70%)`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: `var(${colorVar})` }}>
          {DOMAIN_LABEL[domain]}
        </span>
        <PulseRing pct={pct} colorVar={colorVar} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 text-sm">{children}</div>
    </Link>
  );
}
