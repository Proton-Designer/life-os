import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCardCore, archiveCardCore, listActiveCardsCore, pickNextCardForUserCore, submitReflectionCore } from "../actions-core";

interface CardRow {
  id: string;
  user_id: string;
  kind: string;
  content: string;
  active: boolean;
  last_shown_at: string | null;
  created_at: string;
}
interface ReflectionRow {
  id: string;
  user_id: string;
  card_id: string;
  response: string | null;
  logged_at: string;
}

/** A real, minimal in-memory two-table DB -- proves cross-user isolation and archive-never-deletes against actual row survival, not just call-args assertions. */
function makeDb(cards: CardRow[] = [], reflections: ReflectionRow[] = []) {
  let nextId = 0;
  const genId = () => `gen-${nextId++}`;

  function cardsTable() {
    let eqFilters: [string, unknown][] = [];
    let op: "select" | "insert" | "update" = "select";
    let insertRow: Partial<CardRow> = {};
    let updatePatch: Partial<CardRow> = {};

    const builder = {
      select: () => builder,
      eq(col: string, val: unknown) {
        eqFilters.push([col, val]);
        return builder;
      },
      insert(row: Partial<CardRow>) {
        op = "insert";
        insertRow = row;
        return builder;
      },
      update(patch: Partial<CardRow>) {
        op = "update";
        updatePatch = patch;
        return builder;
      },
      single: () => resolveSingle(),
      maybeSingle: () => resolveSingle(true),
      then(resolve: (v: { data: CardRow[] | null; error: null }) => void) {
        if (op === "select") {
          const rows = cards.filter((r) => eqFilters.every(([c, v]) => (r as never)[c] === v));
          resolve({ data: rows, error: null });
          return;
        }
        if (op === "update") {
          for (const row of cards) {
            if (eqFilters.every(([c, v]) => (row as never)[c] === v)) Object.assign(row, updatePatch);
          }
          resolve({ data: null, error: null });
        }
      },
    };

    function resolveSingle(allowNull = false) {
      if (op === "insert") {
        const row: CardRow = {
          id: genId(),
          user_id: insertRow.user_id as string,
          kind: insertRow.kind as string,
          content: insertRow.content as string,
          active: true,
          last_shown_at: null,
          created_at: new Date().toISOString(),
        };
        cards.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (op === "update") {
        const idx = cards.findIndex((r) => eqFilters.every(([c, v]) => (r as never)[c] === v));
        if (idx < 0) return Promise.resolve({ data: allowNull ? null : undefined, error: null });
        cards[idx] = { ...cards[idx]!, ...updatePatch };
        return Promise.resolve({ data: { id: cards[idx]!.id }, error: null });
      }
      const rows = cards.filter((r) => eqFilters.every(([c, v]) => (r as never)[c] === v));
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    return builder;
  }

  function reflectionsTable() {
    let insertRow: Partial<ReflectionRow> = {};
    const builder = {
      insert(row: Partial<ReflectionRow>) {
        insertRow = row;
        return {
          then(resolve: (v: { error: null }) => void) {
            reflections.push({
              id: genId(),
              user_id: insertRow.user_id as string,
              card_id: insertRow.card_id as string,
              response: (insertRow.response as string | null) ?? null,
              logged_at: new Date().toISOString(),
            });
            resolve({ error: null });
          },
        };
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (table === "reflection_cards") return cardsTable();
      if (table === "end_of_hour_reflections") return reflectionsTable();
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, cards, reflections };
}

describe("createCardCore", () => {
  it("creates an active card with the given kind/content", async () => {
    const { client, cards } = makeDb();
    const res = await createCardCore(client, "user-1", "goal", "  Ship the thing  ");
    expect(res.ok).toBe(true);
    expect(res.card?.content).toBe("Ship the thing");
    expect(res.card?.active).toBe(true);
    expect(cards).toHaveLength(1);
  });

  it("rejects an unknown kind", async () => {
    const { client } = makeDb();
    const res = await createCardCore(client, "user-1", "not-a-kind", "content");
    expect(res.ok).toBe(false);
  });

  it("rejects empty/whitespace-only content", async () => {
    const { client } = makeDb();
    const res = await createCardCore(client, "user-1", "trait", "   ");
    expect(res.ok).toBe(false);
  });
});

describe("archiveCardCore -- never deletes", () => {
  it("sets active=false, the row still physically exists", async () => {
    const { client, cards } = makeDb([{ id: "c1", user_id: "user-1", kind: "goal", content: "x", active: true, last_shown_at: null, created_at: "t" }]);
    const res = await archiveCardCore(client, "user-1", "c1");
    expect(res.ok).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.active).toBe(false);
  });

  it("is a 0-row no-op for another user's card, not a cross-user mutation", async () => {
    const { client, cards } = makeDb([{ id: "c1", user_id: "user-2", kind: "goal", content: "x", active: true, last_shown_at: null, created_at: "t" }]);
    const res = await archiveCardCore(client, "user-1", "c1");
    expect(res.ok).toBe(false);
    expect(cards[0]!.active).toBe(true);
  });
});

describe("listActiveCardsCore", () => {
  it("returns only this user's active cards -- cross-user isolation, archived excluded", async () => {
    const { client } = makeDb([
      { id: "c1", user_id: "user-1", kind: "goal", content: "a", active: true, last_shown_at: null, created_at: "t" },
      { id: "c2", user_id: "user-1", kind: "trait", content: "b", active: false, last_shown_at: null, created_at: "t" },
      { id: "c3", user_id: "user-2", kind: "goal", content: "c", active: true, last_shown_at: null, created_at: "t" },
    ]);
    const cards = await listActiveCardsCore(client, "user-1");
    expect(cards.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("pickNextCardForUserCore", () => {
  it("picks the oldest-shown active card for this user only", async () => {
    const { client } = makeDb([
      { id: "c1", user_id: "user-1", kind: "goal", content: "a", active: true, last_shown_at: "2026-06-01T00:00:00.000Z", created_at: "t" },
      { id: "c2", user_id: "user-1", kind: "goal", content: "b", active: true, last_shown_at: null, created_at: "t" },
    ]);
    const res = await pickNextCardForUserCore(client, "user-1");
    expect(res.card?.id).toBe("c2");
  });

  it("returns null when there are no active cards", async () => {
    const { client } = makeDb();
    const res = await pickNextCardForUserCore(client, "user-1");
    expect(res.card).toBeNull();
  });
});

describe("submitReflectionCore", () => {
  it("logs the reflection and stamps last_shown_at on the card", async () => {
    const { client, cards, reflections } = makeDb([{ id: "c1", user_id: "user-1", kind: "goal", content: "a", active: true, last_shown_at: null, created_at: "t" }]);
    const res = await submitReflectionCore(client, "user-1", "c1", "  did the thing  ");
    expect(res.ok).toBe(true);
    expect(reflections).toHaveLength(1);
    expect(reflections[0]!.response).toBe("did the thing");
    expect(cards[0]!.last_shown_at).not.toBeNull();
  });

  it("a null/empty response logs honestly as null, never an empty string", async () => {
    const { client, reflections } = makeDb([{ id: "c1", user_id: "user-1", kind: "goal", content: "a", active: true, last_shown_at: null, created_at: "t" }]);
    await submitReflectionCore(client, "user-1", "c1", "   ");
    expect(reflections[0]!.response).toBeNull();
  });

  it("refuses to log against another user's card", async () => {
    const { client, reflections } = makeDb([{ id: "c1", user_id: "user-2", kind: "goal", content: "a", active: true, last_shown_at: null, created_at: "t" }]);
    const res = await submitReflectionCore(client, "user-1", "c1", "x");
    expect(res.ok).toBe(false);
    expect(reflections).toHaveLength(0);
  });

  it("refuses to log against an archived card", async () => {
    const { client, reflections } = makeDb([{ id: "c1", user_id: "user-1", kind: "goal", content: "a", active: false, last_shown_at: null, created_at: "t" }]);
    const res = await submitReflectionCore(client, "user-1", "c1", "x");
    expect(res.ok).toBe(false);
    expect(reflections).toHaveLength(0);
  });
});
