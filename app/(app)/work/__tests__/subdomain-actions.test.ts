import { beforeEach, describe, expect, it, vi } from "vitest";

function makeChain(resolvedValue: { data: unknown; error: null } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };
}

const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
let fromImpl: (table: string) => ReturnType<typeof makeChain>;
const fromMock = vi.fn((table: string) => fromImpl(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock }, from: fromMock })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Work subdomain actions", () => {
  beforeEach(() => {
    getClaimsMock.mockClear();
    fromMock.mockClear();
  });

  describe("createWorkSubdomain", () => {
    it("rejects a blank label without touching the database", async () => {
      const { createWorkSubdomain } = await import("../subdomain-actions");
      await expect(createWorkSubdomain("   ", "job")).rejects.toThrow("label is required");
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("throws when the Work domain hasn't been selected yet", async () => {
      const chain = makeChain({ data: null, error: null });
      fromImpl = () => chain;
      const { createWorkSubdomain } = await import("../subdomain-actions");

      await expect(createWorkSubdomain("Acme Consulting", "business")).rejects.toThrow(
        "the Work domain has not been selected"
      );
    });

    it("slugifies the label into `key`, appends to the end of the active set, and stamps `kind`", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-work" }, error: null }),
        user_subdomains: makeChain({
          data: [{ key: "existing-gig", position: 0, archived_at: null }],
          error: null,
        }),
      };
      fromImpl = (table) => tables[table];
      tables.user_subdomains.single = vi.fn(async () => ({
        data: { id: "sub-new", key: "acme-consulting" },
        error: null,
      }));
      const { createWorkSubdomain } = await import("../subdomain-actions");

      const result = await createWorkSubdomain("Acme Consulting!", "business");

      expect(tables.user_subdomains.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          domain_id: "domain-work",
          key: "acme-consulting",
          label: "Acme Consulting!",
          kind: "business",
          position: 1, // after the one existing active row at position 0
          archived_at: null,
        })
      );
      expect(result).toEqual({ id: "sub-new", key: "acme-consulting" });
    });

    it("disambiguates a slug collision with a numeric suffix, checking ALL rows (including archived) since the unique index isn't partial", async () => {
      const tables: Record<string, ReturnType<typeof makeChain>> = {
        user_domains: makeChain({ data: { id: "domain-work" }, error: null }),
        user_subdomains: makeChain({
          data: [
            { key: "side-gig", position: 0, archived_at: null },
            { key: "side-gig-2", position: 1, archived_at: "2026-08-01T00:00:00Z" }, // archived, still taken
          ],
          error: null,
        }),
      };
      fromImpl = (table) => tables[table];
      tables.user_subdomains.single = vi.fn(async () => ({
        data: { id: "sub-new", key: "side-gig-3" },
        error: null,
      }));
      const { createWorkSubdomain } = await import("../subdomain-actions");

      await createWorkSubdomain("Side Gig", "job");

      expect(tables.user_subdomains.insert).toHaveBeenCalledWith(
        expect.objectContaining({ key: "side-gig-3" })
      );
    });
  });

  describe("renameWorkSubdomain", () => {
    it("rejects a blank label", async () => {
      const { renameWorkSubdomain } = await import("../subdomain-actions");
      await expect(renameWorkSubdomain("sub-1", "")).rejects.toThrow("label is required");
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("updates only label (and updated_at) -- key is never touched by a rename", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { renameWorkSubdomain } = await import("../subdomain-actions");

      await renameWorkSubdomain("sub-1", "New Name");

      const [payload] = chain.update.mock.calls[0];
      expect(payload.label).toBe("New Name");
      expect(payload.key).toBeUndefined();
      expect(chain.eq).toHaveBeenCalledWith("id", "sub-1");
      expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    });
  });

  describe("archiveWorkSubdomain", () => {
    it("archives via update, never delete", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { archiveWorkSubdomain } = await import("../subdomain-actions");

      await archiveWorkSubdomain("sub-1");

      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ archived_at: expect.any(String) })
      );
      expect(chain.delete).not.toHaveBeenCalled();
    });
  });

  describe("reorderWorkSubdomains", () => {
    it("rewrites position = array index for every id in the given order", async () => {
      const chain = makeChain();
      fromImpl = () => chain;
      const { reorderWorkSubdomains } = await import("../subdomain-actions");

      await reorderWorkSubdomains(["sub-c", "sub-a", "sub-b"]);

      expect(chain.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: 0 }));
      expect(chain.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: 1 }));
      expect(chain.update).toHaveBeenNthCalledWith(3, expect.objectContaining({ position: 2 }));
      expect(chain.eq).toHaveBeenNthCalledWith(1, "id", "sub-c");
      expect(chain.eq).toHaveBeenNthCalledWith(3, "id", "sub-a");
    });
  });
});
