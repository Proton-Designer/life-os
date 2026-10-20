import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ReaderImportError } from "./errors";

export const URL_TIMEOUT_MS = 15_000;
export const URL_MAX_BYTES = 5 * 1024 * 1024;
export const URL_MAX_REDIRECTS = 3;

/** True for any address a server-side fetch must never reach: loopback, private, link-local, metadata, CGNAT, multicast, reserved. */
export function isBlockedAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / compatible (::ffff:a.b.c.d, ::a.b.c.d) -> judge the embedded v4.
    const dotted = /^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (dotted) return isBlockedV4(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower === "::" || lower === "::1") return true;
    const g = expandV6(lower);
    if (!g) return true; // unparseable: never allow
    const first = g[0];
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 -> could embed a private v4
    if (first === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
    if (first === 0x2002) return true; // 2002::/16 6to4: embeds a v4 that could be private
    if (first === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo: embeds a v4 server + client
    if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
    if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard-only
    return false;
  }
  return true; // not an IP at all: never allow
}

/** The eight 16-bit groups of an IPv6 literal (any `::` compression, optional dotted-v4 tail), or null if malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (tail) {
    const o = tail.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, tail.index) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => parseInt(h, 16)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const out = halves.length === 1 ? head : [...head, ...new Array(fill).fill(0), ...rest];
  return out.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : out;
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113) ||
    a >= 224
  );
}

export interface FetchedUrl {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface FetchOptions {
  /** Address policy; defaults to !isBlockedAddress. Tests inject a permissive one to reach a local server. */
  isAddressAllowed?: (ip: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

function fail(msg?: string, cause?: unknown): never {
  throw new ReaderImportError("fetch_failed", msg, { cause });
}

export function parseImportUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return fail("That doesn't look like a valid link.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") fail("Only http and https links can be imported.");
  if (u.username || u.password) fail("Links with a username or password aren't supported.");
  return u;
}

/**
 * Fetch a URL with an SSRF guard. The guard runs INSIDE the socket's DNS lookup (and on literal IPs up front), so the
 * address that was checked is the address connected to: no resolve-then-fetch gap for DNS rebinding. Redirects are
 * followed manually (max 3) and re-checked the same way.
 */
export async function fetchUrl(rawUrl: string, opts: FetchOptions = {}): Promise<FetchedUrl> {
  const allowed = opts.isAddressAllowed ?? ((ip: string) => !isBlockedAddress(ip));
  const timeoutMs = opts.timeoutMs ?? URL_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? URL_MAX_BYTES;
  const deadline = Date.now() + timeoutMs;

  let url = parseImportUrl(rawUrl);
  for (let hop = 0; hop <= URL_MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, allowed, Math.max(1, deadline - Date.now()), maxBytes);
    if (res.redirect) {
      if (hop === URL_MAX_REDIRECTS) fail("That link redirects too many times.");
      try {
        url = parseImportUrl(new URL(res.redirect, url).toString());
      } catch (err) {
        if (err instanceof ReaderImportError) throw err;
        fail("That link redirects somewhere invalid.", err);
      }
      continue;
    }
    return { finalUrl: url.toString(), contentType: res.contentType, bytes: res.bytes };
  }
  return fail("That link redirects too many times.");
}

interface HopResult {
  redirect?: string;
  contentType: string;
  bytes: Uint8Array;
}

function requestOnce(url: URL, allowed: (ip: string) => boolean, timeoutMs: number, maxBytes: number): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !allowed(host)) {
      reject(new ReaderImportError("fetch_failed", "That link points to a private or local address, which can't be imported."));
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const lookup: net.LookupFunction = (hostname, options, cb) => {
      dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, "", 4);
        const list = Array.isArray(addrs) ? addrs : [];
        if (list.length === 0 || list.some((a) => !allowed(a.address))) {
          const e = Object.assign(new Error("blocked address"), { code: "EBLOCKED" }) as NodeJS.ErrnoException;
          return cb(e, "", 4);
        }
        if (options.all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        return cb(null, list[0].address, list[0].family);
      });
    };
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup,
        headers: { "user-agent": "Mozilla/5.0 (compatible; LifeOSReader/1.0)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.1", "accept-encoding": "identity" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          done(() => resolve({ redirect: res.headers.location, contentType: "", bytes: new Uint8Array() }));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          done(() => reject(new ReaderImportError("fetch_failed", `The site answered ${status}.`)));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          done(() => reject(new ReaderImportError("too_large", "That page is too large to import (limit 5 MB).")));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            done(() => reject(new ReaderImportError("too_large", "That page is too large to import (limit 5 MB).")));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done(() => resolve({ contentType: String(res.headers["content-type"] ?? ""), bytes: new Uint8Array(Buffer.concat(chunks)) })));
        res.on("error", (e) => done(() => reject(new ReaderImportError("fetch_failed", undefined, { cause: e }))));
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new ReaderImportError("fetch_failed", "That site took too long to respond.")));
    }, timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) =>
      done(() =>
        reject(
          new ReaderImportError(
            "fetch_failed",
            e.code === "EBLOCKED" ? "That link points to a private or local address, which can't be imported." : e.code === "ENOTFOUND" ? "That site couldn't be found." : undefined,
            { cause: e }
          )
        )
      )
    );
    req.end();
  });
}
