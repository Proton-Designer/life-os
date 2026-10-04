import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  user_id: string;
  domain_id: string;
  key: string;
  label: string;
  kind: string | null;
  widgets: unknown;
  config: unknown;
  position: number;
  archived_at: string | null;
};

const row = (over: Partial<Row> & Pick<Row, "id" | "key">): Row => ({
  user_id: "user-1",
  domain_id: "domain-work",
  label: over.key,
  kind: "job",
  widgets: [],
  config: {},
  position: 0,
  archived_at: null,
  ...over,
});

let rows: Row[] = [];
let upsertError: Error | null = null;
const upsertMock = vi.fn(async (..._args: unknown[]) => ({ error: upsertError }));

function subdomainsChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.upsert = upsertMock;
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}
function domainsChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: { id: "domain-work" }, error: null }));
  return chain;
}

const fromMock = vi.fn((table: string) => (table === "user_domains" ? domainsChain() : subdomainsChain()));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null })) },
    from: fromMock,
  })),
}));
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));

const written = () => (upsertMock.mock.calls[0]?.[0] as (Row & { updated_at: string })[]) ?? [];

describe("saveWorkTabs", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    revalidatePathMock.mockClear();
    upsertError = null;
    rows = [
      row({ id: "a", key: "co-op", label: "Co-op", position: 0 }),
      row({ id: "b", key: "side", label: "Side", position: 1, kind: "business" }),
      row({ id: "c", key: "old", label: "Old", position: 2, archived_at: "2026-01-01T00:00:00Z" }),
    ];
  });

  it("applies renames and order in ONE upsert, positions 0..n-1 by index", async () => {
    const { saveWorkTabs } = await import("../subdomain-actions");
    await saveWorkTabs([
      { key: "side", label: "  Studio " },
      { key: "co-op", label: "Co-op" },
    ]);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(written().map((r) => [r.id, r.label, r.position, r.archived_at])).toEqual([
      ["b", "Studio", 0, null],
      ["a", "Co-op", 1, null],
    ]);
    expect(upsertMock.mock.calls[0]?.[1]).toEqual({ onConflict: "id" });
  });

  it("never sends widgets/config/kind (a stale read must not overwrite them) -- positive control: ensureBusinessWorkTab's new row does carry them", async () => {
    const { saveWorkTabs, ensureBusinessWorkTab } = await import("../subdomain-actions");
    await saveWorkTabs([{ key: "co-op", label: "Co-op" }, { key: "side", label: "Side" }]);
    for (const r of written()) {
      expect(r).not.toHaveProperty("widgets");
      expect(r).not.toHaveProperty("config");
      expect(r).not.toHaveProperty("kind");
      expect(Object.keys(r).sort()).toEqual(["archived_at", "domain_id", "id", "key", "label", "position", "updated_at", "user_id"]);
    }
    upsertMock.mockClear();
    rows = [row({ id: "a", key: "co-op" })];
    await ensureBusinessWorkTab();
    expect(written()[0]).toHaveProperty("widgets");
  });

  it("archives (never deletes) a tab and renumbers the rest", async () => {
    const { saveWorkTabs } = await import("../subdomain-actions");
    await saveWorkTabs([
      { key: "co-op", label: "Co-op", archived: true },
      { key: "side", label: "Side" },
    ]);
    const byId = Object.fromEntries(written().map((r) => [r.id, r]));
    expect(byId.a.archived_at).not.toBeNull();
    expect(byId.b.position).toBe(0);
    expect(byId.b.archived_at).toBeNull();
  });

  it.each([
    ["unknown key", [{ key: "ghost", label: "x" }, { key: "co-op", label: "Co-op" }]],
    ["duplicate key", [{ key: "co-op", label: "a" }, { key: "co-op", label: "b" }]],
    ["blank label", [{ key: "co-op", label: "   " }, { key: "side", label: "Side" }]],
    ["41-char label", [{ key: "co-op", label: "x".repeat(41) }, { key: "side", label: "Side" }]],
    ["missing an active tab", [{ key: "co-op", label: "Co-op" }]],
    ["an already-archived tab", [{ key: "co-op", label: "a" }, { key: "side", label: "b" }, { key: "old", label: "c" }]],
  ])("rejects %s and writes nothing", async (_name, tabs) => {
    const { saveWorkTabs } = await import("../subdomain-actions");
    await expect(saveWorkTabs(tabs as never)).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("accepts a 40-char label (boundary)", async () => {
    const { saveWorkTabs } = await import("../subdomain-actions");
    await saveWorkTabs([{ key: "co-op", label: "x".repeat(40) }, { key: "side", label: "Side" }]);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to archive every tab (keep at least one)", async () => {
    const { saveWorkTabs } = await import("../subdomain-actions");
    await expect(
      saveWorkTabs([
        { key: "co-op", label: "Co-op", archived: true },
        { key: "side", label: "Side", archived: true },
      ])
    ).rejects.toThrow("keep at least one");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("surfaces a database error", async () => {
    upsertError = new Error("db down");
    const { saveWorkTabs } = await import("../subdomain-actions");
    await expect(saveWorkTabs([{ key: "co-op", label: "Co-op" }, { key: "side", label: "Side" }])).rejects.toThrow("db down");
  });
});

describe("ensureBusinessWorkTab", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    upsertError = null;
  });

  it("creates a business tab at position 0 and shifts the others to 1+", async () => {
    rows = [row({ id: "a", key: "co-op", position: 0 }), row({ id: "z", key: "second", position: 3 })];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    const result = await ensureBusinessWorkTab();
    expect(result).toEqual({ key: "business", created: true });
    const w = written();
    expect(w[0]).toMatchObject({ key: "business", label: "Business", kind: "business", position: 0, archived_at: null });
    expect(w.slice(1).map((r) => [r.key, r.position])).toEqual([["co-op", 1], ["second", 2]]);
  });

  it("WORK-W1b: with NO active tab it also creates a job tab 'Work' (position 1) so the existing Work screen stays reachable", async () => {
    rows = [];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    await ensureBusinessWorkTab();
    expect(written().map((r) => [r.key, r.kind, r.position])).toEqual([["business", "business", 0], ["work", "job", 1]]);
  });

  it("WORK-W1b control: with an active tab present it does NOT add a job tab; a taken 'work' key becomes work-2", async () => {
    rows = [row({ id: "a", key: "co-op", position: 0 })];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    await ensureBusinessWorkTab();
    expect(written().map((r) => r.key)).toEqual(["business", "co-op"]);
    upsertMock.mockClear();
    rows = [row({ id: "z", key: "work", archived_at: "2026-01-01T00:00:00Z" })];
    await ensureBusinessWorkTab();
    expect(written().map((r) => r.key)).toEqual(["business", "work-2"]);
  });

  it("is idempotent when an active business tab exists (no write)", async () => {
    rows = [row({ id: "a", key: "co-op" }), row({ id: "b", key: "biz", kind: "business", position: 1 })];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    expect(await ensureBusinessWorkTab()).toEqual({ key: "biz", created: false });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("brings an archived business tab back instead of duplicating it", async () => {
    rows = [
      row({ id: "a", key: "co-op" }),
      row({ id: "b", key: "biz", kind: "business", label: "My shop", position: 5, archived_at: "2026-01-01T00:00:00Z" }),
    ];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    expect(await ensureBusinessWorkTab()).toEqual({ key: "biz", created: true });
    const w = written();
    expect(w.map((r) => r.id)).toEqual(["b", "a"]);
    expect(w[0]).toMatchObject({ label: "My shop", position: 0, archived_at: null });
  });

  it("avoids a key collision with a non-business tab named business", async () => {
    rows = [row({ id: "a", key: "business", kind: "job" }), row({ id: "b", key: "business-2", kind: "job", position: 1 })];
    const { ensureBusinessWorkTab } = await import("../subdomain-actions");
    expect((await ensureBusinessWorkTab()).key).toBe("business-3");
  });
});

describe("refreshWorkViews", () => {
  it("revalidates the root layout once", async () => {
    revalidatePathMock.mockClear();
    const { refreshWorkViews } = await import("../subdomain-actions");
    await refreshWorkViews();
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });
});
