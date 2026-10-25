import type { LocalClassRow } from "@/lib/canvas/sync-core";

/**
 * "CS 3345.HON - F26", "CS-3345-HON" and "CS3345" are the same course. A course number is subject letters + number digits: this
 * pulls every such pair out of free text and normalizes it to UPPERCASE letters + digits ("CS3345"). A cross-listed Canvas label
 * ("CS-3341.HON-SE-3341.HON-STAT-3341.HON - F26") yields one key per listing. A section, honors or term suffix ("HON", "5H3", "F26")
 * is ignored: it has no letters+digits shape of its own (letters 2-5 then 3-4 digits).
 */
const COURSE_NUMBER = /([A-Za-z]{2,5})[\s._-]*(\d{3,4})(?!\d)/g;

export function courseNumberKeys(text: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!text) return keys;
  for (const m of text.matchAll(COURSE_NUMBER)) keys.add(`${m[1]!.toUpperCase()}${m[2]!}`);
  return keys;
}

/**
 * The person's own class for a Canvas course label, matched by course number. Any of the label's subject+number pairs may match a
 * class's code or name; the match is returned ONLY when exactly one class matches. Zero or several (a lecture and its lab share a
 * number) return null: the caller then creates a class as before, never guesses between two.
 */
export function findClassByCourseNumber(classes: LocalClassRow[], labels: (string | null | undefined)[]): LocalClassRow | null {
  const wanted = new Set<string>();
  for (const label of labels) for (const key of courseNumberKeys(label)) wanted.add(key);
  if (wanted.size === 0) return null;
  const matches = classes.filter((c) => {
    const own = new Set([...courseNumberKeys(c.code), ...courseNumberKeys(c.shortName)]);
    return [...own].some((k) => wanted.has(k));
  });
  const ids = new Set(matches.map((c) => c.id));
  return ids.size === 1 ? matches[0]! : null;
}
