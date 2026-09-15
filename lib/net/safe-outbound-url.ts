import "server-only";
import { promises as dns } from "node:dns";

/**
 * SSRF guard for outbound requests to user-supplied "instance URL" style
 * inputs (Canvas today; RescueTime, Whoop and Phase 4 webhooks are expected
 * to reuse this — flagged by security review during P2-20). From this
 * server's point of view a BYO instance URL is attacker-controlled: nothing
 * else stops a user pasting http://169.254.169.254/ (cloud metadata) or a
 * hostname that resolves to a private/internal address, and having this
 * server fetch it with a bearer credential attached.
 *
 * THREE LAYERS, each closing a gap the others don't:
 *   1. Syntax (`checkUrlSyntax`) — https only, no embedded credentials, no
 *      explicit port. Cheap, no I/O, checked first.
 *   2. DNS (`resolveSafeOutboundUrl`) — resolves EVERY A/AAAA answer and
 *      rejects if ANY of them is loopback/private/link-local/CGNAT/
 *      unspecified, including IPv4-mapped IPv6 forms. A multi-answer
 *      response is rejected on its first bad answer, not just the first one
 *      returned (defeats a DNS server that answers differently per query).
 *   3. Redirects (`safeFetch`) — native fetch() follows redirects
 *      transparently, which would let an already-validated
 *      https://good-host.com respond 302 to http://169.254.169.254 and skip
 *      layers 1–2 entirely. safeFetch never auto-follows; it re-validates
 *      every hop itself, up to `maxRedirects`.
 *
 * NO CACHING, BY DESIGN: resolveSafeOutboundUrl does a fresh DNS lookup on
 * every call, including every single request safeFetch makes. A host that
 * resolved to a public address when a user first connected can be
 * re-pointed at an internal address later (DNS rebinding / TOCTOU) — the
 * only real defense is re-checking at the moment of the actual network
 * call, never trusting an earlier validation. Callers that also validate at
 * save time (e.g. canvas-actions.ts's `connectCanvas`) still get this same
 * fresh check on every subsequent fetch through `safeFetch` — the save-time
 * check and the fetch-time check are independent, not a cache of each other.
 */

export type SafeUrlCheck = { ok: true } | { ok: false; message: string };

const MAX_REDIRECTS = 3;

export function checkUrlSyntax(rawUrl: string): SafeUrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "Only https:// URLs are allowed." };
  if (url.username || url.password) return { ok: false, message: "The URL can't contain a username or password." };
  if (url.port) return { ok: false, message: "A custom port isn't allowed." };
  return { ok: true };
}

/**
 * Scheme + host only — no path, query, or fragment. This is what callers
 * should store (e.g. canvas_connections.instance_url), never the raw pasted
 * string: a stored path/query is attacker-influenced content that would
 * otherwise ride along on every future fetch built from it.
 */
export function safeOrigin(rawUrl: string): string {
  return new URL(rawUrl).origin;
}

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InRange(addr: string, base: string, bits: number): boolean {
  const a = addr.split(".").map(Number);
  const b = base.split(".").map(Number);
  if (a.length !== 4 || a.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // fail closed on anything unparseable
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(a) & mask) === (ipv4ToInt(b) & mask);
}

function isBlockedIPv4(addr: string): boolean {
  return (
    ipv4InRange(addr, "127.0.0.0", 8) || // loopback
    ipv4InRange(addr, "10.0.0.0", 8) || // private
    ipv4InRange(addr, "172.16.0.0", 12) || // private
    ipv4InRange(addr, "192.168.0.0", 16) || // private
    ipv4InRange(addr, "100.64.0.0", 10) || // CGNAT
    ipv4InRange(addr, "169.254.0.0", 16) || // link-local (cloud metadata lives here)
    addr === "0.0.0.0" // unspecified
  );
}

function isBlockedIPv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true; // loopback / unspecified
  const v4Mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isBlockedIPv4(v4Mapped[1]); // IPv4-mapped IPv6 — check the embedded v4 address
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true; // fe80::/10 link-local
  return false;
}

export async function resolveSafeOutboundUrl(rawUrl: string): Promise<SafeUrlCheck> {
  const syntax = checkUrlSyntax(rawUrl);
  if (!syntax.ok) return syntax;
  const { hostname } = new URL(rawUrl);
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, message: "Couldn't resolve that host." };
  }
  if (addresses.length === 0) return { ok: false, message: "Couldn't resolve that host." };
  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
    if (blocked) {
      return { ok: false, message: "That host resolves to a private or internal address, which isn't allowed." };
    }
  }
  return { ok: true };
}

/**
 * Fetch with redirects handled manually and re-validated — never delegates
 * to fetch()'s own transparent redirect-following (module header, layer 3).
 * Throws rather than returning an unchecked Response, so a rejected target
 * can't be mistaken for a successful fetch by a caller that forgets to
 * check a result flag.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = MAX_REDIRECTS): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await resolveSafeOutboundUrl(currentUrl);
    if (!check.ok) throw new Error(check.message);
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
    if (!isRedirect) return res;
    if (hop === maxRedirects) throw new Error("Too many redirects.");
    currentUrl = new URL(res.headers.get("location")!, currentUrl).toString();
  }
  throw new Error("Too many redirects.");
}
