// NAV-01a: the Router Cache now lives 30 minutes, so a Server Action that runs on a timer must never
// call revalidatePath/revalidateTag/refresh -- each call would drop every cached page every tick.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Source of `export async function <name>` up to the next top-level `export`/EOF. */
function functionSource(file: string, name: string): string {
  const src = readFileSync(join(ROOT, file), "utf8");
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ${file}`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next === -1 ? rest : rest.slice(0, next);
}

const REVALIDATES = /revalidatePath|revalidateTag|router\.refresh|updateTag|refresh\(\)/;

const POLLED: Array<[string, string]> = [
  ["app/(app)/actions.ts", "getNotificationsForNow"],
  ["app/(app)/checkin/allocation-actions.ts", "getAllocationQueueForNow"],
  ["app/(app)/distractions/actions.ts", "getTodayDistractionCountForNow"],
  ["app/(app)/distractions/actions.ts", "getSessionDistractionCountForNow"],
  ["app/(app)/calendar/actions.ts", "getWeekCalendar"],
];

describe("polled Server Actions never invalidate the Router Cache", () => {
  it("positive control: the scanner does flag a function that revalidates", () => {
    expect(functionSource("app/(app)/actions.ts", "refreshHome")).toMatch(REVALIDATES);
  });

  it.each(POLLED)("%s :: %s", (file, name) => {
    const body = functionSource(file, name);
    expect(body.length).toBeGreaterThan(40); // it really extracted a body
    expect(body).not.toMatch(REVALIDATES);
  });
});
