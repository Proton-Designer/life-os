import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchUrl, isBlockedAddress, parseImportUrl } from "../url";
import { ReaderImportError } from "../errors";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "127.8.8.8", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:a9fe:a9fe", "::ffff:7f00:1", "64:ff9b::7f00:1", "not-an-ip",
    "2002:7f00:1::1", "2002:c0a8:101::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1", "fec0::1", "febf::1", "feff:ffff::1", "100::1", "100:0:0:0:ffff::1", "2001:db8::1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  // Positive control: the guard is not simply "block everything".
  it.each(["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "192.169.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888", "2001:1::1", "100:0:0:1::1", "2a00:1450:4001::1", "fe7f::1"])("allows public %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false)
  );
});

describe("parseImportUrl", () => {
  it("accepts http(s) only and rejects embedded credentials", () => {
    expect(parseImportUrl("https://example.com/a").hostname).toBe("example.com");
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://u:p@example.com", "not a url"]) {
      expect(() => parseImportUrl(bad)).toThrowError(ReaderImportError);
    }
  });
});

describe("fetchUrl against a local server", () => {
  let server: http.Server;
  let base: string;
  const big = Buffer.alloc(6 * 1024 * 1024, 97);
  const open = () => true;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = req.url ?? "/";
      if (u === "/ok") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><body>hello</body></html>");
      if (u === "/r1") return void res.writeHead(302, { location: "/r2" }).end();
      if (u === "/r2") return void res.writeHead(302, { location: "/ok" }).end();
      if (u === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
      if (u === "/to-private") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (u === "/big") return void res.writeHead(200, { "content-type": "text/html" }).end(big);
      if (u === "/slow") return; // never answers
      if (u === "/404") return void res.writeHead(404).end("nope");
      res.writeHead(200).end("x");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it("positive control: the same URL is reachable when the policy allows it and BLOCKED by the default guard", async () => {
    const ok = await fetchUrl(`${base}/ok`, { isAddressAllowed: open });
    expect(new TextDecoder().decode(ok.bytes)).toContain("hello");
    expect(ok.contentType).toContain("text/html");
    await expect(fetchUrl(`${base}/ok`)).rejects.toMatchObject({ code: "fetch_failed", message: expect.stringMatching(/private or local/) });
  });

  it("blocks a hostname that resolves to loopback (localhost) via the lookup guard", async () => {
    await expect(fetchUrl(`http://localhost:${new URL(base).port}/ok`)).rejects.toMatchObject({ code: "fetch_failed" });
    const viaLookup = await fetchUrl(`http://localhost:${new URL(base).port}/ok`, { isAddressAllowed: open }).catch((e) => e);
    // with the permissive policy localhost may or may not bind 127.0.0.1 (::1 first); either result is fine, but it must not be the guard message
    if (viaLookup instanceof ReaderImportError) expect(viaLookup.message).not.toMatch(/private or local/);
  });

  it("follows up to 3 redirects, then gives up", async () => {
    expect((await fetchUrl(`${base}/r1`, { isAddressAllowed: open })).finalUrl).toBe(`${base}/ok`);
    await expect(fetchUrl(`${base}/loop`, { isAddressAllowed: open })).rejects.toMatchObject({ message: expect.stringMatching(/too many times/) });
  });

  it("re-checks every redirect hop (public -> metadata IP is refused)", async () => {
    const onlyLocal = (ip: string) => ip === "127.0.0.1";
    await expect(fetchUrl(`${base}/to-private`, { isAddressAllowed: onlyLocal })).rejects.toMatchObject({ code: "fetch_failed", message: expect.stringMatching(/private or local/) });
  });

  it("enforces the byte cap (declared and streamed) and the timeout, and reports non-2xx", async () => {
    await expect(fetchUrl(`${base}/big`, { isAddressAllowed: open })).rejects.toMatchObject({ code: "too_large" });
    await expect(fetchUrl(`${base}/slow`, { isAddressAllowed: open, timeoutMs: 200 })).rejects.toMatchObject({ code: "fetch_failed", message: expect.stringMatching(/too long/) });
    await expect(fetchUrl(`${base}/404`, { isAddressAllowed: open })).rejects.toMatchObject({ code: "fetch_failed", message: expect.stringMatching(/404/) });
  });
});
