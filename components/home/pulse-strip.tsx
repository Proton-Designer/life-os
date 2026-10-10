import Link from "next/link";
import type { DomainPulse } from "@/lib/home/get-domain-pulse";

const RINGS: {
  key: keyof DomainPulse;
  label: string;
  href: string;
  colorVar: string;
}[] = [
  { key: "deen", label: "Faith", href: "/deen", colorVar: "--accent-deen" },
  { key: "business", label: "Business", href: "/business", colorVar: "--accent-business" },
  { key: "fitness", label: "Fitness", href: "/fitness", colorVar: "--accent-fitness" },
  { key: "school", label: "School", href: "/school", colorVar: "--accent-school" },
];

export function PulseStrip({ pulse, deenMode }: { pulse: DomainPulse; deenMode: boolean }) {
  return (
    <div className="flex justify-around gap-2">
      {RINGS.filter((ring) => deenMode || ring.key !== "deen").map((ring) => {
        const pct = Math.round((pulse[ring.key] ?? 0) * 100);
        return (
          <Link
            key={ring.key}
            href={ring.href}
            className="flex flex-col items-center gap-2"
          >
            <div
              className="size-14 rounded-full p-1"
              style={{
                background: `conic-gradient(var(${ring.colorVar}) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
              }}
            >
              <div className="flex size-full items-center justify-center rounded-full bg-background text-xs font-medium">
                {pct}%
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{ring.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
