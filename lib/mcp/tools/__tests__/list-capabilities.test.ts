import { describe, expect, it } from "vitest";
import { listCapabilitiesTool, resolveListCapabilitiesOperation } from "../list-capabilities";

function textPayload(outcome: Awaited<ReturnType<typeof listCapabilitiesTool>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected a text block");
  return JSON.parse(block.text);
}

describe("listCapabilitiesTool", () => {
  it("with no domain, lists only domains actually wired — honest, not the memo's full eventual matrix", async () => {
    const outcome = await listCapabilitiesTool();
    const payload = textPayload(outcome);
    expect(payload.domains.map((d: { domain: string }) => d.domain).sort()).toEqual(["business", "deen", "school", "self_mastery", "work"]);
  });

  it("source_chunks is listed (existence is not secret) but advertises ZERO readable fields at any tier (content is)", async () => {
    const outcome = await listCapabilitiesTool("self_mastery");
    const payload = textPayload(outcome);
    expect(payload.entities).toHaveLength(1);
    expect(payload.entities[0].entity).toBe("source_chunks");
    expect(payload.entities[0].fields.summary).toEqual([]);
    expect(payload.entities[0].fields.full).toEqual([]);
  });

  it("with a known domain, lists its entities with fields/detail/filterable info", async () => {
    const outcome = await listCapabilitiesTool("deen");
    const payload = textPayload(outcome);
    expect(payload.domain).toBe("deen");
    expect(payload.entities).toHaveLength(8);
    const prayer = payload.entities.find((e: { entity: string }) => e.entity === "prayer");
    expect(prayer).toMatchObject({
      entity: "prayer",
      detail_levels: ["ids", "summary", "full"],
      // "write:log" only -- NOT "write:unlog" (see write-registry.ts's
      // header + docs/ai-connector/WRITE-DELETE-DECISION.md). Discovery
      // must report exactly what `write` will accept, never round up.
      actions: ["read", "write:log"],
    });
    expect(prayer.fields.summary).toEqual(["date", "prayer_name", "status"]);
    expect(prayer.fields.full).toContain("logged_at");
  });

  it("THROWS a clear error for an unknown domain, naming the valid set — never a silent empty result", async () => {
    await expect(listCapabilitiesTool("fitness")).rejects.toThrow(/unknown domain.*fitness/i);
    await expect(listCapabilitiesTool("fitness")).rejects.toThrow(/deen/);
  });

  it("reports write actions ONLY for the 3 entities write-registry.ts actually wires — habit/habit_log/weekly_focus/etc. stay read-only, honestly", async () => {
    const outcome = await listCapabilitiesTool("deen");
    const payload = textPayload(outcome);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(byEntity.prayer).toEqual(["read", "write:log"]);
    expect(byEntity.sunnah_log).toEqual(["read", "write:toggle"]);
    expect(byEntity.adhkar).toEqual(["read", "write:toggle"]);
    for (const stillReadOnly of ["quran_session", "reflection_entry", "habit", "habit_log", "weekly_focus"]) {
      expect(byEntity[stillReadOnly]).toEqual(["read"]);
    }
  });

  it("source_chunks (self_mastery) has no write surface at all", async () => {
    const outcome = await listCapabilitiesTool("self_mastery");
    const payload = textPayload(outcome);
    expect(payload.entities[0].actions).toEqual(["read"]);
  });

  it("work/business entities report their real write actions from write-registry.ts, live", async () => {
    const work = await listCapabilitiesTool("work");
    const workByEntity = Object.fromEntries((await textPayload(work)).entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(workByEntity.target.sort()).toEqual(["read", "write:complete", "write:create", "write:edit", "write:reorder"]);
    expect(workByEntity.task).not.toContain("write:remove");
    expect(workByEntity.task).not.toContain("write:bulk_remove");

    const business = await listCapabilitiesTool("business");
    const businessByEntity = Object.fromEntries((await textPayload(business)).entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(businessByEntity.kill_list_item.sort()).toEqual(["read", "write:set", "write:toggle"]);
    expect(businessByEntity.weekly_goal.sort()).toEqual(["read", "write:save"]);
  });

  it("school's entities report their real write actions, and never an excluded hard-delete/recurrence action", async () => {
    const outcome = await listCapabilitiesTool("school");
    const payload = textPayload(outcome);
    expect(payload.entities).toHaveLength(4);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));

    expect(byEntity.task.sort()).toEqual(["read", "write:add", "write:edit", "write:toggle"]);
    expect(byEntity.task).not.toContain("write:remove");

    expect(byEntity.class.sort()).toEqual(["read", "write:create", "write:edit"]);

    expect(byEntity.class_assessment.sort()).toEqual(["read", "write:add", "write:edit"]);
    expect(byEntity.class_assessment).not.toContain("write:remove");

    expect(byEntity.schedule_event.sort()).toEqual(["read", "write:cancel_occurrence", "write:edit_series", "write:set_override"]);
    expect(byEntity.schedule_event).not.toContain("write:create");
    expect(byEntity.schedule_event).not.toContain("write:remove");
    expect(byEntity.schedule_event).not.toContain("write:remove_override");
    expect(byEntity.schedule_event).not.toContain("write:uncancel");
  });
});

describe("resolveListCapabilitiesOperation", () => {
  it("is domain-scoped when a domain is given", () => {
    expect(resolveListCapabilitiesOperation("deen")).toBe("discovery.deen.list_capabilities");
  });

  it("is generic when no domain is given", () => {
    expect(resolveListCapabilitiesOperation()).toBe("discovery.list_capabilities");
  });
});
