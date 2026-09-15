import { describe, expect, it } from "vitest";
import { makeFakeMcpDb } from "@/lib/scheduling/__tests__/fake-mcp-tables";
import { clientIpFromHeaders, hashRegistrationIp, registerOAuthClient, MAX_REGISTRATIONS_PER_IP_PER_HOUR } from "../oauth";

/**
 * P4-13 (migration 217): the global 50-client lockout is gone; dynamic client
 * registration is limited per (HMAC-hashed) IP per hour instead. Runs the
 * real registerOAuthClient against an in-memory mcp_oauth_clients table.
 */

const now = new Date("2026-09-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
const META = { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" };

function staleClients(n: number, ipHash: string | null = null, msAgo = 3 * 86_400_000) {
  return Array.from({ length: n }, (_, i) => ({
    client_id: `stale-${ipHash ?? "noip"}-${i}`,
    client_name: "old",
    redirect_uris: ["https://x.example.com/cb"],
    created_at: iso(msAgo),
    registration_ip_hash: ipHash,
  }));
}

describe("P4-13 registration: no global lockout", () => {
  it("still registers a new client when 60 stale clients already exist (the old cap was 50)", async () => {
    const db = makeFakeMcpDb({ mcp_oauth_clients: staleClients(60) });
    const res = await registerOAuthClient(db.client, META, { ipHash: hashRegistrationIp("203.0.113.9"), now });
    expect(res.ok).toBe(true);
    expect(db.tables.mcp_oauth_clients).toHaveLength(61);
  });
});

describe("P4-13 registration: per-IP hourly limit", () => {
  const ip = "198.51.100.7";

  it(`refuses the ${MAX_REGISTRATIONS_PER_IP_PER_HOUR + 1}th registration from one IP inside an hour, with 429`, async () => {
    const h = hashRegistrationIp(ip)!;
    const db = makeFakeMcpDb({ mcp_oauth_clients: staleClients(MAX_REGISTRATIONS_PER_IP_PER_HOUR, h, 10 * 60_000) });
    const res = await registerOAuthClient(db.client, META, { ipHash: h, now });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(429);
      expect(res.error).toBe("temporarily_unavailable");
    }
    expect(db.tables.mcp_oauth_clients).toHaveLength(MAX_REGISTRATIONS_PER_IP_PER_HOUR);
  });

  it("registrations older than an hour, and from other IPs, don't count", async () => {
    const h = hashRegistrationIp(ip)!;
    const db = makeFakeMcpDb({
      mcp_oauth_clients: [
        ...staleClients(MAX_REGISTRATIONS_PER_IP_PER_HOUR, h, 61 * 60_000),
        ...staleClients(MAX_REGISTRATIONS_PER_IP_PER_HOUR, hashRegistrationIp("192.0.2.1"), 5 * 60_000),
      ],
    });
    const res = await registerOAuthClient(db.client, META, { ipHash: h, now });
    expect(res.ok).toBe(true);
  });

  it("stores only the keyed hash of the IP, never the IP itself", async () => {
    const db = makeFakeMcpDb({ mcp_oauth_clients: [] });
    await registerOAuthClient(db.client, META, { ipHash: hashRegistrationIp(ip), now });
    const stored = db.tables.mcp_oauth_clients[0];
    expect(stored.registration_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(ip);
  });
});

describe("clientIpFromHeaders / hashRegistrationIp", () => {
  it("takes the first x-forwarded-for hop, else x-real-ip, else null", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(clientIpFromHeaders(new Headers({}))).toBeNull();
  });

  it("hash is stable per IP, differs across IPs, and is null for no IP", () => {
    expect(hashRegistrationIp("203.0.113.9")).toBe(hashRegistrationIp("203.0.113.9"));
    expect(hashRegistrationIp("203.0.113.9")).not.toBe(hashRegistrationIp("203.0.113.10"));
    expect(hashRegistrationIp(null)).toBeNull();
  });
});
