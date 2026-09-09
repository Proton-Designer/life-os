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
    expect(payload.domains.map((d: { domain: string }) => d.domain).sort()).toEqual(["deen", "self_mastery"]);
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
    expect(payload.entities).toHaveLength(1);
    expect(payload.entities[0]).toMatchObject({
      entity: "prayer",
      detail_levels: ["ids", "summary", "full"],
      actions: ["read"],
    });
    expect(payload.entities[0].fields.summary).toEqual(["date", "prayer_name", "status"]);
    expect(payload.entities[0].fields.full).toContain("logged_at");
  });

  it("THROWS a clear error for an unknown domain, naming the valid set — never a silent empty result", async () => {
    await expect(listCapabilitiesTool("fitness")).rejects.toThrow(/unknown domain.*fitness/i);
    await expect(listCapabilitiesTool("fitness")).rejects.toThrow(/deen/);
  });

  it("never advertises a \"write\" action — no write tool exists in this layer", async () => {
    const outcome = await listCapabilitiesTool("deen");
    const payload = textPayload(outcome);
    for (const entity of payload.entities) {
      expect(entity.actions).not.toContain("write");
    }
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
