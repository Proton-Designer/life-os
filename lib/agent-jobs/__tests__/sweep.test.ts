import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const { sweepAgentJobs } = await import("../sweep");

describe("sweepAgentJobs", () => {
  it("calls the housekeeping function and returns how many rows it moved", async () => {
    const rpc = vi.fn(async () => ({ data: 3, error: null }));
    expect(await sweepAgentJobs({ rpc } as unknown as SupabaseClient)).toBe(3);
    expect(rpc).toHaveBeenCalledWith("sweep_agent_jobs");
  });
  it("never throws: an error or a rejection reads as 0 (it must not cost the ingestion poll its real work)", async () => {
    expect(await sweepAgentJobs({ rpc: async () => ({ data: null, error: { message: "x" } }) } as unknown as SupabaseClient)).toBe(0);
    expect(await sweepAgentJobs({ rpc: async () => { throw new Error("down"); } } as unknown as SupabaseClient)).toBe(0);
  });
});
