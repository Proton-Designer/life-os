import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRowUpdated } from "../require-row-updated";
import { ToolNotFoundError } from "../tool-input-error";

function makeClient(resolvedData: unknown[] | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.then = (resolve: (v: { data: unknown[] | null; error: unknown }) => void) => resolve({ data: resolvedData, error });
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, chain, from };
}

describe("requireRowUpdated", () => {
  it("throws ToolNotFoundError with the caller's own message when the update matches zero rows", async () => {
    const { client } = makeClient([]);
    await expect(requireRowUpdated(client, "coop_targets", { title: "New" }, "bad-id", "user-1", 'No target found with id "bad-id".')).rejects.toThrow(
      ToolNotFoundError
    );
    await expect(requireRowUpdated(client, "coop_targets", { title: "New" }, "bad-id", "user-1", 'No target found with id "bad-id".')).rejects.toThrow(
      'No target found with id "bad-id".'
    );
  });

  it("does not throw when the update matches a row", async () => {
    const { client } = makeClient([{ id: "t1" }]);
    await expect(requireRowUpdated(client, "coop_targets", { title: "New" }, "t1", "user-1", "unused")).resolves.toBeUndefined();
  });

  it("treats a null data result (not just an empty array) as zero rows", async () => {
    const { client } = makeClient(null);
    await expect(requireRowUpdated(client, "coop_targets", { title: "New" }, "t1", "user-1", "not found")).rejects.toThrow(ToolNotFoundError);
  });

  it("propagates a real Postgres error without swallowing it into a not-found", async () => {
    const { client } = makeClient(null, { message: "connection reset" });
    await expect(requireRowUpdated(client, "coop_targets", { title: "New" }, "t1", "user-1", "not found")).rejects.toThrow("connection reset");
  });

  it("scopes the update by BOTH id and user_id, and chains select onto the SAME update -- never a second query", async () => {
    const { client, chain, from } = makeClient([{ id: "t1" }]);
    await requireRowUpdated(client, "coop_targets", { title: "New" }, "t1", "user-1", "unused");

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("coop_targets");
    expect(chain.update).toHaveBeenCalledWith({ title: "New" });
    expect(chain.eq).toHaveBeenCalledWith("id", "t1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.select).toHaveBeenCalledWith("id");
  });
});
