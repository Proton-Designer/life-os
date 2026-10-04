// NAV-02 (and NAV-01a): background polling must (1) never ride the Server Action queue and (2) never
// invalidate the Router Cache. Next dispatches Server Actions from one client strictly one at a time
// (node_modules/next/dist/docs/01-app/02-guides/server-actions.md "Sequential dispatch on the client";
// client/components/app-router-instance.js dispatchAction appends to actionQueue.last), so a poll that
// is a Server Action makes the user's next tap-write wait behind it. The shell's polled reads are GET
// route handlers under app/api/shell/ instead.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const REVALIDATES = /revalidatePath|revalidateTag|router\.refresh|updateTag|refresh\(\)/;
const SHELL_ROUTES = [
  "app/api/shell/notifications/route.ts",
  "app/api/shell/allocation-queue/route.ts",
  "app/api/shell/distraction-count/route.ts",
  "app/api/shell/week-calendar/route.ts",
  "lib/api/shell-read.ts",
];
/** Server Actions that used to be polled and must not exist (or be called) any more. */
const REMOVED_ACTIONS = ["getNotificationsForNow", "getAllocationQueueForNow", "getTodayDistractionCountForNow", "getSessionDistractionCountForNow"];
const ACTION_FILES = ["app/(app)/actions.ts", "app/(app)/checkin/allocation-actions.ts", "app/(app)/distractions/actions.ts"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "__tests__" || name === "node_modules") continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Names a file imports from an app/** Server Action module (`@/app/...`). */
function importedActionNames(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/app\/[^"']*["']/g)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "");
      if (n) names.push(n);
    }
  }
  return names;
}

/** A "polled read" = a read-shaped action name. Writes (mark*, save*, ...) are legitimately actions. */
const POLLED_READ_NAME = /^get\w*(ForNow|Calendar)$/;

describe("shell polling stays off the Server Action queue (NAV-02)", () => {
  it("canary: this Next version still documents sequential, one-at-a-time Server Action dispatch", () => {
    const doc = read("node_modules/next/dist/docs/01-app/02-guides/server-actions.md");
    expect(doc).toMatch(/one at a time per client/);
    expect(read("node_modules/next/dist/client/components/app-router-instance.js")).toMatch(/actionQueue\.last\.next = newAction/);
  });

  it("the four polled actions are gone from the action modules", () => {
    for (const f of ACTION_FILES) {
      for (const name of REMOVED_ACTIONS) expect(read(f), `${f} still exports ${name}`).not.toMatch(new RegExp(`export async function ${name}\\b`));
    }
  });

  it("no client file that polls (setInterval) imports a polled-read Server Action", () => {
    const pollers = [...sourceFiles("components"), ...sourceFiles("lib")].filter((f) => read(f).includes("setInterval"));
    expect(pollers.length).toBeGreaterThan(3); // the scan really found the pollers
    for (const f of pollers) {
      const bad = importedActionNames(read(f)).filter((n) => POLLED_READ_NAME.test(n));
      expect(bad, `${f} polls a Server Action`).toEqual([]);
    }
  });

  it("positive control: the importer scan flags a poller that imports a polled Server Action", () => {
    const poller = `import { getNotificationsForNow, markRead } from "@/app/(app)/actions";\nsetInterval(refresh, 60000);`;
    expect(importedActionNames(poller).filter((n) => POLLED_READ_NAME.test(n))).toEqual(["getNotificationsForNow"]);
  });

  it("the four pollers fetch through shellFetch", () => {
    const expectations: Array<[string, string]> = [
      ["components/shell/topbar.tsx", "/api/shell/distraction-count"],
      ["components/shell/notifications-bell.tsx", "/api/shell/notifications"],
      ["lib/checkins/allocation-queue-context.tsx", "/api/shell/allocation-queue"],
      ["components/distractions/distraction-capture-dialog.tsx", "/api/shell/distraction-count?sessionId="],
    ];
    for (const [f, path] of expectations) {
      const src = read(f);
      expect(src, f).toContain("shellFetch");
      expect(src, f).toContain(path);
    }
    expect(read("lib/client/fetch-week-calendar.ts")).toContain("/api/shell/week-calendar");
  });
});

describe("shell route handlers never invalidate the Router Cache", () => {
  it.each(SHELL_ROUTES)("%s exists and has no revalidate/refresh", (f) => {
    expect(existsSync(join(ROOT, f)), `${f} missing`).toBe(true);
    expect(read(f)).not.toMatch(REVALIDATES);
  });

  it("positive control: the scanner flags a handler that revalidates", () => {
    expect(`export async function GET() { revalidatePath("/"); }`).toMatch(REVALIDATES);
  });

  it("the remaining background Server Actions (user-initiated or mutating) are not pollers", () => {
    // markNotificationReadForNow writes on a tap; getWeekCalendar is still an action for /calendar's own
    // page render, but no client calls it any more.
    expect(read("lib/client/fetch-week-calendar.ts")).not.toMatch(/@\/app\//);
  });
});
