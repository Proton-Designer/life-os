import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuestionCore, updateQuestionCore, setQuestionActiveCore } from "../questions-core";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert", "update"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("createQuestionCore", () => {
  it("inserts trimmed prompt/answer/topic with the given class/origin, defaulting origin to self", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    const result = await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "  What is Big-O of binary search?  ",
      answer: "  O(log n)  ",
      topic: "  Complexity  ",
      sourceAnchor: "Ch. 3, p.42",
    });

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      class_id: "class-1",
      prompt: "What is Big-O of binary search?",
      answer: "O(log n)",
      topic: "Complexity",
      source_anchor: "Ch. 3, p.42",
      source_skipped: false,
      origin: "self",
    });
    expect(result).toEqual({ id: "q-new" });
  });

  it("accepts an explicit origin (ai/missed) instead of defaulting", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "x",
      answer: "y",
      sourceSkipped: true,
      origin: "missed",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ origin: "missed", source_skipped: true, source_anchor: null }));
  });

  it("rejects an empty (or whitespace-only) prompt before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "   ", answer: "y" })
    ).rejects.toThrow("Prompt is required");
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an empty answer before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "x", answer: "" })
    ).rejects.toThrow("Answer is required");
    expect(from).not.toHaveBeenCalled();
  });

  // The schema's own invariant (questions_anchor_present_or_skipped, migration
  // 111): enforced here BEFORE the network round-trip, not only trusted to the
  // database CHECK — a bad submission must fail fast.
  it("rejects a missing source anchor that isn't marked skipped, before ever calling the database", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(
      createQuestionCore(client, "user-1", { classId: "class-1", prompt: "x", answer: "y" })
    ).rejects.toThrow("Provide a source anchor, or mark it skipped");
    expect(from).not.toHaveBeenCalled();
  });

  it("clears any stray source_anchor text when sourceSkipped is true, never storing both", async () => {
    const chain = makeChain({ data: { id: "q-new" }, error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await createQuestionCore(client, "user-1", {
      classId: "class-1",
      prompt: "x",
      answer: "y",
      sourceSkipped: true,
      sourceAnchor: "leftover text from a previous edit",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ source_anchor: null, source_skipped: true }));
  });
});

describe("updateQuestionCore", () => {
  it("patches only the fields explicitly provided, scoped to id and user_id", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateQuestionCore(client, "user-1", "q-1", { prompt: "  Updated prompt  " });

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.update).toHaveBeenCalledWith({ prompt: "Updated prompt" });
    expect(chain.eq).toHaveBeenCalledWith("id", "q-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("rejects an empty prompt in a patch that touches it", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;

    await expect(updateQuestionCore(client, "user-1", "q-1", { prompt: "   " })).rejects.toThrow("Prompt is required");
    expect(from).not.toHaveBeenCalled();
  });

  it("leaves topic/sourceAnchor untouched when omitted, but clears them to null when explicitly set empty", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateQuestionCore(client, "user-1", "q-1", { topic: "", sourceAnchor: "  " });

    expect(chain.update).toHaveBeenCalledWith({ topic: null, source_anchor: null });
  });
});

describe("setQuestionActiveCore", () => {
  it("retires a question (active: false) without deleting it", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await setQuestionActiveCore(client, "user-1", "q-1", false);

    expect(from).toHaveBeenCalledWith("questions");
    expect(chain.update).toHaveBeenCalledWith({ active: false });
    expect(chain.eq).toHaveBeenCalledWith("id", "q-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("is reversible — the same primitive reactivates a retired question", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await setQuestionActiveCore(client, "user-1", "q-1", true);

    expect(chain.update).toHaveBeenCalledWith({ active: true });
  });
});
