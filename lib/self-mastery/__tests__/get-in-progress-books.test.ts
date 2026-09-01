import { describe, it, expect, vi, beforeEach } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.returns = vi.fn(() => chain);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain;
}

let fromImpl: () => ReturnType<typeof makeChain>;
const fromMock = vi.fn(() => fromImpl());
const requireUserMock = vi.fn(async () => ({ supabase: { from: fromMock }, userId: "user-1" }));

vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

describe("getInProgressBooks", () => {
  beforeEach(() => {
    vi.resetModules();
    fromMock.mockClear();
  });

  // Home must never break because the Self-Mastery schema hasn't deployed
  // yet — this is the specific failure mode DEPLOYING.md's own rule warns
  // about ("code should tolerate both the pre- and post-migration shape").
  it("degrades to an empty list rather than throwing when the query errors (e.g. table doesn't exist yet)", async () => {
    fromImpl = () => makeChain({ data: null, error: { message: 'relation "books" does not exist' } });
    const { getInProgressBooks } = await import("../get-in-progress-books");
    await expect(getInProgressBooks()).resolves.toEqual([]);
  });

  it("maps rows into the generic InProgressItem shape with a self-mastery href", async () => {
    fromImpl = () =>
      makeChain({
        data: [{ id: "book-1", title: "Atomic Habits", status: "processing", stage: "extracting_lessons", progress_pct: 40, created_at: new Date().toISOString() }],
        error: null,
      });
    const { getInProgressBooks } = await import("../get-in-progress-books");
    const items = await getInProgressBooks();
    expect(items).toEqual([
      { id: "book-1", title: "Atomic Habits", statusLabel: "Finding lessons", progressPct: 40, href: "/personal/self_mastery/book-1" },
    ]);
  });
});
