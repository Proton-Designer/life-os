import { describe, expect, it } from "vitest";
import { MORNING_BRIEF_SCHEDULE_PROMPT } from "../schedule-prompt";
import { getWriteAction } from "@/lib/mcp/write-registry";
import { getEntity } from "@/lib/mcp/registry";

describe("MORNING_BRIEF_SCHEDULE_PROMPT", () => {
  it("tells the agent to read first, then call the write op by its exact registered name", () => {
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toMatch(/list_capabilities/);
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toContain('domain "day", entity "morning_brief", action "write"');
    expect(getWriteAction("day", "morning_brief", "write")).not.toBeNull();
  });

  it("every read entity it names exists in the read registry (a stale name would send the agent down a dead end)", () => {
    const named = [...MORNING_BRIEF_SCHEDULE_PROMPT.matchAll(/`([a-z_]+)\.([a-z_]+)`/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(named.length).toBeGreaterThan(3);
    for (const [domain, entity] of named) expect(getEntity(domain, entity), `${domain}.${entity}`).not.toBeNull();
  });

  it("asks for 12-hour times, plain text and the length limit", () => {
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toMatch(/12-hour/);
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toMatch(/9:00 PM/);
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toMatch(/plain text/i);
    expect(MORNING_BRIEF_SCHEDULE_PROMPT).toMatch(/2000/);
  });
});
