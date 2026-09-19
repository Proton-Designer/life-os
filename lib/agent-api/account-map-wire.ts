/**
 * The pure half of the account map (P4-37): types and codec only, no
 * database, no cookies, no module state — split out of account-map.ts
 * (which is `import "server-only"`) specifically so a plain script (run
 * via `npx tsx`, no bundler alias for "server-only") can import the real
 * decoder instead of hand-indexing the wire format itself. That hand-
 * indexing, done wrong, is exactly what produced P4-37's bug: a harness
 * that read `domains[d].read` on what is actually a positional array and
 * got `undefined`, silently, forever.
 *
 * `account-map.ts` re-exports everything here, so no existing consumer of
 * `@/lib/agent-api/account-map` needs to change.
 */

export type AccountArea = "faith" | "body" | "learning" | "work" | "business" | "school";

export interface AccountMapDomain {
  one_line: string;
  active_for_account: boolean;
  read: string[];
  /** Entities with at least one write action; the actions and patch shapes are in list_capabilities(domain). */
  write: string[];
  /** Computed decide-views (P4-27). Empty until built. */
  views: string[];
}

export interface AccountMap {
  today: { local_date: string; timezone: string; local_time: string; timezone_note?: string };
  mode: "legacy" | "domains";
  /** Areas this account tracks, in area order. Legacy accounts see everything, so all are listed. */
  active_areas: AccountArea[];
  vocabulary_map: Record<AccountArea, string[]>;
  /** Keyed by MCP domain name (the name read/write/list_capabilities take). */
  domains: Record<string, AccountMapDomain>;
  next: string;
}

export const ACCOUNT_MAP_DOMAIN_FIELDS = ["one_line", "active_for_account", "read", "write", "views"] as const;

export type AccountMapWire = Omit<AccountMap, "domains"> & {
  domain_fields: typeof ACCOUNT_MAP_DOMAIN_FIELDS;
  domains: Record<string, [string, boolean, string[], string[], string[]]>;
};

/**
 * The map as an agent receives it over the wire: identical content, but each
 * domain is a row in `domain_fields` order instead of an object repeating the
 * five key names. That repetition was ~30% of the payload (13 domains × ~70
 * chars) and grows with every domain, which would push the map past its
 * 800-token budget as read/write coverage lands (P4-05..09). Code consumers
 * (and P4-20's agent.md) use the named `AccountMap`; only the serialization
 * is compact. A test round-trips one into the other.
 */
export function toAccountMapWire(map: AccountMap): AccountMapWire {
  const domains: AccountMapWire["domains"] = {};
  for (const [name, d] of Object.entries(map.domains)) {
    domains[name] = [d.one_line, d.active_for_account, d.read, d.write, d.views];
  }
  const { domains: _named, ...rest } = map;
  return { ...rest, domain_fields: ACCOUNT_MAP_DOMAIN_FIELDS, domains };
}

/**
 * The inverse of `toAccountMapWire` (P4-37) — until this existed, every
 * consumer of the wire format was expected to hand-index each domain row,
 * which is exactly what produced P4-37's bug: a script that instead did a
 * NAMED property access on the row (an array) and got `undefined` back,
 * silently, forever.
 *
 * Derives each field's position from `wire.domain_fields` — the field order
 * the PAYLOAD ITSELF carries — not a hardcoded index, and not even this
 * module's own `ACCOUNT_MAP_DOMAIN_FIELDS` constant. Self-describing on
 * purpose: `domain_fields` is on the wire specifically so a consumer with no
 * access to this file's TypeScript (a real external agent reading raw JSON)
 * can decode a row without hardcoding the schema, and this decoder honors
 * that same contract rather than quietly assuming its own copy always
 * matches. A decoder with `row[2]` in it, or one that reads the local
 * constant instead of the payload's own field list, is the same bug waiting
 * for a field reorder — account-map.test.ts's round-trip test proves this
 * one isn't, by perturbing `domain_fields` on the payload and confirming
 * the decode changes with it.
 */
export function fromAccountMapWire(wire: AccountMapWire): AccountMap {
  const domains: AccountMap["domains"] = {};
  for (const [name, row] of Object.entries(wire.domains)) {
    domains[name] = Object.fromEntries(wire.domain_fields.map((field, i) => [field, row[i]])) as unknown as AccountMapDomain;
  }
  const { domains: _wireDomains, domain_fields: _fields, ...rest } = wire;
  return { ...rest, domains };
}
