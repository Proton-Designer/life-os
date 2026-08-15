export type CellTreatment = "solid" | "hatch" | "hollow";

/**
 * A second visual channel for ConsistencyGrid cells, on top of hue —
 * required, not opt-in, because the on-time/qada/missed set fails the
 * dataviz method's normal-vision floor at the amber/red adjacent pair
 * (ΔE 13.0, below the 15 floor), and that floor is a hard fail secondary
 * encoding does not excuse for a categorical series. Texture is normally an
 * accessibility-setting opt-in; this grid is the deliberate exception.
 */
export function consistencyCellStyle(treatment: CellTreatment, colorVar: string): React.CSSProperties {
  switch (treatment) {
    case "solid":
      return { backgroundColor: `var(${colorVar})` };
    case "hatch":
      // 45deg only (never 0/90 — those read as gridlines/bars), tone-on-tone.
      return {
        backgroundColor: `color-mix(in oklch, var(${colorVar}) 15%, transparent)`,
        backgroundImage: `repeating-linear-gradient(45deg, var(${colorVar}) 0, var(${colorVar}) 2px, transparent 2px, transparent 4px)`,
      };
    case "hollow":
      return {
        backgroundColor: "transparent",
        border: `2px solid var(${colorVar})`,
      };
  }
}
