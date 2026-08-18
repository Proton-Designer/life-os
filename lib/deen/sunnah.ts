import type { PrayerName } from "@/lib/prayer-times/windows";

export type SunnahSlot = "before" | "after" | "witr";
export type SunnahEmphasis = "mu'akkadah" | "ghayr mu'akkadah" | "witr";

export type SunnahDefinition = {
  prayerName: PrayerName;
  slot: SunnahSlot;
  rakah: number;
  emphasis: SunnahEmphasis;
};

// The rawatib, per docs/superpowers/specs/2026-08-17-prayer-time-intelligence.md
// §Phase 3. Order matters for display (before-slots read before after-slots),
// and (prayerName, slot) pairs are unique — matching sunnah_logs' own unique
// constraint (migration 017).
export const RAWATIB: SunnahDefinition[] = [
  { prayerName: "fajr", slot: "before", rakah: 2, emphasis: "mu'akkadah" },
  { prayerName: "dhuhr", slot: "before", rakah: 4, emphasis: "mu'akkadah" },
  { prayerName: "dhuhr", slot: "after", rakah: 2, emphasis: "mu'akkadah" },
  { prayerName: "asr", slot: "before", rakah: 4, emphasis: "ghayr mu'akkadah" },
  { prayerName: "maghrib", slot: "after", rakah: 2, emphasis: "mu'akkadah" },
  { prayerName: "isha", slot: "after", rakah: 2, emphasis: "mu'akkadah" },
  { prayerName: "isha", slot: "witr", rakah: 3, emphasis: "witr" },
];

/** A variable-length list — Fajr has one, Dhuhr has two, never a fixed shape. */
export function sunnahForPrayer(prayerName: PrayerName): SunnahDefinition[] {
  return RAWATIB.filter((s) => s.prayerName === prayerName);
}
