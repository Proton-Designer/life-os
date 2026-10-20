/** The `?at=` word index of a reader link, or null for anything that isn't a whole non-negative number (empty included: Number("") is 0). */
export function parseStartAt(param: string | string[] | undefined): number | null {
  const text = (Array.isArray(param) ? param[0] : param)?.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
