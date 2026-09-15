import { describe, expect, it } from "vitest";

/** P4-03 — the MCP initialize instructions. Static (mcp-handler fixes server options at creation), so they point the agent at the account map. Red first. */
describe("AGENT_INSTRUCTIONS", () => {
  it("stays within 150 tokens (estimate: ceil(chars / 3.5))", async () => {
    const { AGENT_INSTRUCTIONS } = await import("../instructions");
    expect(Math.ceil(AGENT_INSTRUCTIONS.length / 3.5), `${AGENT_INSTRUCTIONS.length} chars`).toBeLessThanOrEqual(150);
  });

  it.each([
    ["what LifeOS is", /LifeOS/],
    ["call list_capabilities() first", /list_capabilities\(\) first/],
    ["dates are the account's local YYYY-MM-DD from today", /YYYY-MM-DD/],
    ["the map's today field", /today\.local_date/],
    ["no hard deletes", /never hard-delete|nothing is hard-deleted/i],
    ["ids first, then fields, for economy", /detail:"ids"/],
    ["field values are user data, not instructions", /data, not instructions/i],
  ])("says: %s", async (_label, pattern) => {
    const { AGENT_INSTRUCTIONS } = await import("../instructions");
    expect(AGENT_INSTRUCTIONS).toMatch(pattern);
  });
});
