import Link from "next/link";
import type { PriorityItem } from "@/lib/home/types";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { featuredCardStyle } from "@/lib/featured-card-style";
import { IconChip } from "@/components/ui/icon-chip";

export type PeekDomain = PriorityItem["domain"];

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
  const accent = DOMAIN_ACCENT[domain];
  const colorVar = ACCENT_VAR[accent];
  const pct = Math.round(pulse * 100);

  return (
    <Link
      href={href}
      data-testid={`domain-peek-card-${domain}`}
      className="flex snap-start flex-col gap-3 rounded-2xl border p-5 transition-colors hover:bg-accent/10 md:min-w-0"
      style={featuredCardStyle(colorVar, { borderOpacity: 25, washOpacity: 10 })}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <IconChip icon={DOMAIN_ICON[domain]} accent={accent} size="sm" />
          <span className="text-sm font-semibold" style={{ color: `var(${colorVar})` }}>
            {DOMAIN_LABEL[domain]}
          </span>
        </div>
        <PulseRing pct={pct} colorVar={colorVar} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 text-sm">{children}</div>
    </Link>
  );
}
