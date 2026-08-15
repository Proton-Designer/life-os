/**
 * Shared style for the app's "featured" accent-tinted card treatment
 * (KpiCard, StatCard's `featured` mode, NextUpHero, DomainPeekCard,
 * LockInSession, HabitBuilder's focus card). Previously each of these
 * independently copy-pasted a `radial-gradient(…, transparent 70%)` with
 * NO opaque base — past 70% of the ellipse the card became fully
 * transparent, so identical components rendered as different surfaces
 * depending on scroll/page position (the body's own maroon glow bled
 * through near the top, near-black lower down). Caught in the 2026-08-15
 * structural refactor review. Three layers, all opaque together:
 * `--card` base -> flat accent tint -> radial wash on top.
 */
export function featuredCardStyle(
  colorVar: string,
  opts?: { borderOpacity?: number; washOpacity?: number; tintOpacity?: number }
): React.CSSProperties {
  const borderOpacity = opts?.borderOpacity ?? 30;
  const washOpacity = opts?.washOpacity ?? 16;
  const tintOpacity = opts?.tintOpacity ?? 10;
  const tint = `color-mix(in oklch, var(${colorVar}) ${tintOpacity}%, transparent)`;

  return {
    borderColor: `color-mix(in oklch, var(${colorVar}) ${borderOpacity}%, transparent)`,
    backgroundColor: "var(--card)",
    backgroundImage: `radial-gradient(ellipse at top left, color-mix(in oklch, var(${colorVar}) ${washOpacity}%, transparent) 0%, transparent 70%), linear-gradient(${tint}, ${tint})`,
  };
}
